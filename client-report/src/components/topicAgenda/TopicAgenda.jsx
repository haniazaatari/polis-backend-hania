import React, { useEffect } from "react";
import { useReportId } from "../framework/useReportId";
import { useTopicData } from "./hooks/useTopicData";
import { useAgendaBuilder } from "./hooks/useAgendaBuilder";
import { getFilteredTopics } from "./utils/topicFiltering";
import LayerHeader from "./components/LayerHeader";
import TopicsGrid from "./components/TopicsGrid";
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
  
  const {
    currentLayer,
    bankedTopics,
    currentSelections,
    completedLayers,
    setCurrentSelections,
    toggleTopicSelection,
    bankAndClear,
    resetAgenda
  } = useAgendaBuilder(hierarchyAnalysis);

  // Fetch UMAP data when topic data is loaded
  useEffect(() => {
    if (topicData && conversation) {
      fetchUMAPData(conversation);
    }
  }, [topicData, conversation, fetchUMAPData]);

  // Auto-select close topics when layer changes
  useEffect(() => {
    if (!topicData || !hierarchyAnalysis || currentLayer === null || bankedTopics.size === 0) {
      return;
    }

    const runKeys = Object.keys(topicData.runs);
    const firstRun = topicData.runs[runKeys[0]];
    const allTopics = firstRun.topics_by_layer[currentLayer];
    
    if (allTopics) {
      const topicEntries = getFilteredTopics(allTopics, currentLayer, hierarchyAnalysis, bankedTopics, clusterGroups);
      const autoSelectedTopics = new Set();
      
      topicEntries.forEach(entry => {
        if (entry.proximityScore !== null && entry.proximityScore < 1.0) {
          autoSelectedTopics.add(entry.topic.topic_key);
        }
      });
      
      if (autoSelectedTopics.size > 0) {
        setCurrentSelections(autoSelectedTopics);
        console.log(`Auto-selected ${autoSelectedTopics.size} topics with distance < 1.0 in Layer ${currentLayer}`);
      }
    }
  }, [currentLayer, bankedTopics.size, topicData, hierarchyAnalysis, clusterGroups, setCurrentSelections]);

  // Render current layer
  const renderCurrentLayer = () => {
    if (!topicData || !hierarchyAnalysis || currentLayer === null) {
      return <div className="no-data">No topic data available</div>;
    }

    const runKeys = Object.keys(topicData.runs);
    const firstRun = topicData.runs[runKeys[0]];
    
    if (!firstRun.topics_by_layer || !firstRun.topics_by_layer[currentLayer]) {
      return <div className="no-data">No topics found for layer {currentLayer}</div>;
    }

    const allTopics = firstRun.topics_by_layer[currentLayer];
    const topicEntries = getFilteredTopics(allTopics, currentLayer, hierarchyAnalysis, bankedTopics, clusterGroups);
    const totalTopicsCount = Object.keys(allTopics).length;
    
    return (
      <div className="current-layer">
        <LayerHeader
          hierarchyAnalysis={hierarchyAnalysis}
          completedLayers={completedLayers}
          currentLayer={currentLayer}
          currentSelections={currentSelections}
          topicEntries={topicEntries}
          totalTopicsCount={totalTopicsCount}
          onBankAndClear={bankAndClear}
          onReset={resetAgenda}
        />
        
        <TopicsGrid
          topicEntries={topicEntries}
          bankedTopics={bankedTopics}
          firstRun={firstRun}
          currentLayer={currentLayer}
          currentSelections={currentSelections}
          onToggleSelection={toggleTopicSelection}
          clusterGroups={clusterGroups}
          hierarchyAnalysis={hierarchyAnalysis}
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="topic-agenda">
        <h1>Topic Agenda Builder</h1>
        <div className="loading">Loading topic data...</div>
        <TopicAgendaStyles />
      </div>
    );
  }

  if (error) {
    return (
      <div className="topic-agenda">
        <h1>Topic Agenda Builder</h1>
        <div className="error-message">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
        <TopicAgendaStyles />
      </div>
    );
  }

  return (
    <div className="topic-agenda">
      {renderCurrentLayer()}
      <TopicAgendaStyles />
    </div>
  );
};

export default TopicAgenda;