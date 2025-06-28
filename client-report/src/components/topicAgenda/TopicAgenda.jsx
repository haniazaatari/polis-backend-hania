import React, { useEffect, useState } from "react";
import { useReportId } from "../framework/useReportId";
import { useTopicData } from "./hooks/useTopicData";
import { extractArchetypalComments, serializeArchetypes } from "./utils/archetypeExtraction";
import LayerHeader from "./components/LayerHeader";
import ScrollableTopicsGrid from "./components/ScrollableTopicsGrid";
import TopicAgendaStyles from "./components/TopicAgendaStyles";

const TopicAgenda = ({ conversation }) => {
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
    // to use as stable anchor points for comment routing
    
    console.log("Selected topics:", Array.from(selections));
    
    // Extract archetypal comments from selections
    const archetypes = extractArchetypalComments(selections, topicData, clusterGroups);
    console.log("Extracted archetypes:", archetypes);
    
    // Serialize for storage
    const stableAnchors = serializeArchetypes(archetypes);
    
    // Fetch comment texts for debugging
    // TODO: This should ideally come from the UMAP data or a dedicated endpoint
    const commentIds = stableAnchors.anchors.map(a => a.commentId);
    console.log("Fetching texts for comment IDs:", commentIds);
    
    // For now, log what we have
    console.log("Stable anchor points for routing:", stableAnchors);
    console.log("Detailed archetype info:", archetypes);
    
    // TODO: Send to backend or store locally
    // These comment IDs + coordinates will be used for distance-based routing
    // instead of relying on topic centroids that change between runs
    
    alert(`Selected ${stableAnchors.anchors.length} archetypal comments from ${selections.size} topics\n\nCheck console for details including comment IDs.`);
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