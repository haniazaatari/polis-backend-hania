## Clustering Pipeline

The math service builds both `base-clusters` and `group-clusters` inside
`polismath.math.conversation/small-conv-update-graph` (and its large-conversation
variant). The process runs each time we recompute a conversation.

### Base Clusters

- **Input data**: Participants who are “in the conversation.”  
  `:in-conv` is built from `user-vote-counts`, admitting anyone who has voted on
  either every comment or at least 7 comments, with a greedy backfill to ensure
  15 people when possible.
- **Coordinates**: Votes are centered and fed into the PCA pipeline. Participant
  rows are projected into 2D with
  `pca/sparsity-aware-project-ptpts`, yielding `proj-nmat`, a named matrix whose
  rows are participant IDs and columns `["x" "y"]`.
- **Clustering**: `clusters/kmeans` runs on the in-conversation projections.
  The default `:base-k` is 100, tunable via conv update opts. If we have prior
  clusters, they are supplied through `:last-clusters` so the algorithm can warm
  start.
  - `clusters/kmeans` delegates to `clean-start-clusters` to recenter and
      deduplicate prior clusters, falling back to `init-clusters` (distinct
      points) only when necessary.
  - Each iteration uses `cluster-step`, which assigns points via euclidean
      distance in PCA space and recomputes centers with optional weights.
  - Empty clusters are dropped; if the data collapse entirely, a single cluster
      containing everyone is synthesized to keep the math stable.
- **Output shape**: The result is a vector of maps
  `{:id <int> :members [pid ...] :center [x y]}`, sorted by `:id`. When writing
  to Postgres (see `polismath.conv-man/prep-main`), the clusters are "folded"
  with `clusters/fold-clusters`, producing the persisted `base-clusters` record
  (parallel arrays of ids, members, x, y, count).

### Group Clusters

- **Source**: Built on top of the base clusters. First, we convert their centers
  into `base-clusters-proj` via `clusters/xy-clusters-to-nmat2`, so each base
  cluster becomes a point in the same PCA coordinate system.
- **Candidate ks**: For each `k` in the range `2 .. max-k`, we compute a
  clustering:
  - `max-k` comes from `conversation/max-k-fn`, bounded by the number of base
      clusters (roughly `max 2, min(max-k, 2 + n_base/12)`).
  - The actual clustering again calls `clusters/kmeans`, but this time the
      `weights` map counts the number of participants per base cluster, so large
      clusters pull the centroid appropriately.
  - Prior results are supplied from `conv[:group-clusterings k]` to provide
      continuity across recomputes.
- **Model selection**: We evaluate each candidate with a silhouette score
  (`clusters/silhouette`) computed from the pairwise distance matrix of base
  cluster centers. The best-performing `k` is stored in `:group-k-smoother`,
  which requires seeing the same `k` `:group-k-buffer` times (default 4) before
  switching, preventing jitter between adjacent recomputes.
- **Final form**: The chosen clustering is emitted as `group-clusters`, again a
  sequence of maps `{:id <int> :members [base-cluster-id ...] :center [x y]}`.
  Persistence later folds these when writing to storage.

### Subgroup Clusters (for context)

The same pattern repeats per group to produce `subgroup-clusters`. Each group
clustering searches its own `k` range, reuses previous centers, and smooths
`k` transitions via `:subgroup-k-smoother`. Although not asked for directly,
understanding this tier explains the nested cluster fields in the math payload.
