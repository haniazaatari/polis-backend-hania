import React, { useEffect, useState } from "react";
import { useReportId } from "../framework/useReportId";
import { useTopicData } from "./hooks/useTopicData";
import { extractArchetypalComments, serializeArchetypes } from "./utils/archetypeExtraction";
import LayerHeader from "./components/LayerHeader";
import ScrollableTopicsGrid from "./components/ScrollableTopicsGrid";
import TopicAgendaStyles from "./components/TopicAgendaStyles";

const TopicAgenda = ({ conversation, comments }) => {
  const { report_id } = useReportId();
  const {
    loading,
    error,
    topicData,
    hierarchyAnalysis,
    clusterGroups,
    fetchUMAPData
  } = useTopicData(report_id);
  
  const [selections, setSelections] = useState(new Set());
  const [commentMap, setCommentMap] = useState(new Map());

  // Build comment map for easy lookup
  useEffect(() => {
    if (comments && comments.length > 0) {
      const map = new Map();
      comments.forEach(comment => {
        // Store by both tid (as number) and as string for flexibility
        map.set(comment.tid, comment.txt);
        map.set(String(comment.tid), comment.txt);
      });
      setCommentMap(map);
      console.log(`Built comment map with ${map.size / 2} comments`);
    }
  }, [comments]);

  // Fetch UMAP data when topic data is loaded
  useEffect(() => {
    if (topicData && conversation) {
      fetchUMAPData(conversation);
    }
  }, [topicData, conversation, fetchUMAPData]);

  const toggleTopicSelection = (topicKey) => {
    const newSelections = new Set(selections);
    if (newSelections.has(topicKey)) {
      newSelections.delete(topicKey);
    } else {
      newSelections.add(topicKey);
    }
    setSelections(newSelections);
  };

  const handleDone = async () => {
    // Convert topic selections to archetypal comments
    // Each topic selection represents a cluster of comments in UMAP space
    // We need to identify representative comments from each selected topic
    // to use as stable anchor points
    
    console.log("Selected topics:", Array.from(selections));
    
    // Extract archetypal comments from selections
    const archetypes = extractArchetypalComments(selections, topicData, clusterGroups, commentMap);
    console.log("Extracted archetypes:", archetypes);
    
    // Serialize for storage
    const stableAnchors = serializeArchetypes(archetypes);
    
    // Fetch comment texts for debugging
    // TODO: This should ideally come from the UMAP data or a dedicated endpoint
    const commentIds = stableAnchors.anchors.map(a => a.commentId);
    console.log("Comment IDs for selected archetypes:", commentIds);
    
    // For now, log what we have
    console.log("Stable anchor points:", stableAnchors);
    console.log("Detailed archetype info:", archetypes);
    
    // Log in a more readable format
    console.log("\n=== SELECTED ARCHETYPAL COMMENTS ===");
    archetypes.forEach(group => {
      console.log(`\nTopic: Layer ${group.layerId}, Cluster ${group.clusterId}`);
      group.archetypes.forEach((archetype, i) => {
        console.log(`  ${i + 1}. "${archetype.text}" (ID: ${archetype.commentId})`);
      });
    });
    console.log("=====================================\n");
    
    // TODO: Send to backend or store locally
    // These comment IDs + coordinates will be used as persistent references
    // instead of relying on topic centroids that change between runs
  };

  if (loading) {
    return (
      <div className="topic-agenda">
        <div className="topic-agenda-widget">
          <div className="loading">Loading topic data...</div>
        </div>
        <TopicAgendaStyles />
      </div>
    );
  }

  if (error) {
    return (
      <div className="topic-agenda">
        <div className="topic-agenda-widget">
          <div className="error-message">
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        </div>
        <TopicAgendaStyles />
      </div>
    );
  }

  return (
    <div className="topic-agenda">
      <div className="topic-agenda-widget">
        <div className="current-layer">
          <LayerHeader />
          
          <ScrollableTopicsGrid
            topicData={topicData}
            selections={selections}
            onToggleSelection={toggleTopicSelection}
            clusterGroups={clusterGroups}
            hierarchyAnalysis={hierarchyAnalysis}
          />
          
          <div className="done-button-container">
            <button 
              className="done-button"
              onClick={handleDone}
              disabled={selections.size === 0}
            >
              Done ({selections.size} selected)
            </button>
          </div>
        </div>
      </div>
      <TopicAgendaStyles />
    </div>
  );
};

export default TopicAgenda;