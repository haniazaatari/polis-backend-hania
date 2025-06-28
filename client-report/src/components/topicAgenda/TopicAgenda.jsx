import React, { useEffect, useState } from "react";
import { useReportId } from "../framework/useReportId";
import { useTopicData } from "./hooks/useTopicData";
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

  const handleDone = () => {
    // TODO: Submit selections
    console.log("Selected topics:", Array.from(selections));
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