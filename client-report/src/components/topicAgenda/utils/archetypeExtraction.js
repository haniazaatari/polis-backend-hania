import { calculateClusterCentroid, calculateDistance } from './topicUtils';

/**
 * Extract archetypal comments from topic selections
 * These serve as stable anchor points for comment routing across Delphi runs
 * 
 * STRATEGY:
 * 1. For each selected topic, find its cluster in UMAP space
 * 2. Identify the most representative comments (archetypes)
 * 3. Return comment IDs that can be used for distance-based routing
 * 
 * WHY THIS MATTERS:
 * - Topic names/clusters change between Delphi runs
 * - But the underlying comments remain stable
 * - By storing comment IDs instead of topic IDs, we maintain consistency
 * - These archetypal comments represent what users actually care about
 */
export const extractArchetypalComments = (selections, topicData, clusterGroups) => {
  const archetypeComments = [];
  
  // Parse selections to extract layer and cluster info
  selections.forEach(topicKey => {
    // Topic key format: "4c5b018b-51ac-4a3e-9d41-6307a73ebf68#2#3"
    // Extract layer and cluster ID
    const parts = topicKey.split('#');
    if (parts.length >= 3) {
      const layerId = parseInt(parts[parts.length - 2]);
      const clusterId = parts[parts.length - 1];
      
      // Find the cluster in clusterGroups
      const clusterKey = `${layerId}_${clusterId}`;
      const clusterPoints = clusterGroups[layerId]?.get(clusterKey);
      
      if (clusterPoints && clusterPoints.length > 0) {
        // Strategy 1: Get comments closest to cluster centroid
        const centroid = calculateClusterCentroid(clusterPoints);
        
        if (centroid) {
          // Sort points by distance to centroid
          const sortedPoints = clusterPoints
            .map(point => ({
              ...point,
              distanceToCentroid: calculateDistance(
                { x: point.umap_x, y: point.umap_y },
                centroid
              )
            }))
            .sort((a, b) => a.distanceToCentroid - b.distanceToCentroid);
          
          // Take the top N most central comments as archetypes
          const numArchetypes = Math.min(3, sortedPoints.length);
          const archetypes = sortedPoints.slice(0, numArchetypes);
          
          archetypeComments.push({
            topicKey,
            layerId,
            clusterId,
            archetypes: archetypes.map(a => ({
              commentId: a.comment_id,
              text: a.comment_text || `[Comment ${a.comment_id}]`, // Include text if available
              distance: a.distanceToCentroid,
              coordinates: { x: a.umap_x, y: a.umap_y }
            }))
          });
        }
      }
    }
  });
  
  return archetypeComments;
};

/**
 * Convert archetypal comments to a format suitable for storage
 * This creates a stable representation that survives Delphi re-runs
 */
export const serializeArchetypes = (archetypeComments) => {
  // Flatten to just comment IDs and their coordinates
  const stableAnchors = [];
  
  archetypeComments.forEach(group => {
    group.archetypes.forEach(archetype => {
      stableAnchors.push({
        commentId: archetype.commentId,
        text: archetype.text, // Include text for debugging
        coordinates: archetype.coordinates,
        sourceLayer: group.layerId,
        sourceCluster: group.clusterId
      });
    });
  });
  
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    anchors: stableAnchors,
    totalSelections: archetypeComments.length
  };
};