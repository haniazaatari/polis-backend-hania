import React from "react";
import TopicItem from "./TopicItem";

const TopicsGrid = ({ 
  topicEntries, 
  bankedTopics, 
  firstRun, 
  currentLayer, 
  currentSelections, 
  onToggleSelection, 
  clusterGroups,
  hierarchyAnalysis 
}) => {
  const renderBankedTopics = () => {
    return Array.from(bankedTopics.entries()).map(([layerId, topicKeys]) => {
      if (layerId === currentLayer) return null; // Don't show current layer banked topics here
      
      const layerTopics = firstRun.topics_by_layer[layerId];
      return Array.from(topicKeys).map(topicKey => {
        const topic = Object.values(layerTopics).find(t => t.topic_key === topicKey);
        if (!topic) return null;
        
        const parts = topicKey.split('_');
        const clusterId = parts[parts.length - 1];
        
        return (
          <TopicItem
            key={topicKey}
            entry={{ clusterId, topic, proximityScore: null }}
            layerId={layerId}
            isSelected={true}
            onToggleSelection={() => {}}
            clusterGroups={clusterGroups}
            isBanked={true}
          />
        );
      });
    });
  };

  const renderCurrentLayerTopics = () => {
    const maxLayer = hierarchyAnalysis ? Math.max(...hierarchyAnalysis.layers) : currentLayer;
    const isFinestLayers = currentLayer < maxLayer - 1;
    
    console.log(`🔍 Layer ${currentLayer}: maxLayer=${maxLayer}, isFinestLayers=${isFinestLayers}`);
    
    if (!isFinestLayers) {
      // Coarsest and second coarsest: show all topics normally
      return topicEntries.map((entry) => (
        <TopicItem
          key={entry.topic.topic_key}
          entry={entry}
          layerId={currentLayer}
          isSelected={currentSelections.has(entry.topic.topic_key)}
          onToggleSelection={onToggleSelection}
          clusterGroups={clusterGroups}
        />
      ));
    } else {
      // Finest layers: check if we need to split by distance
      const topicsAboveDistance1 = topicEntries.filter(entry => 
        entry.proximityScore !== null && entry.proximityScore >= 1.0
      );
      
      const shouldSplit = topicsAboveDistance1.length > 15;
      console.log(`🔍 Layer ${currentLayer}: ${topicsAboveDistance1.length} topics >= distance 1.0, shouldSplit=${shouldSplit}`);
      
      if (!shouldSplit) {
        // Not too many topics, show all normally
        return topicEntries.map((entry) => (
          <TopicItem
            key={entry.topic.topic_key}
            entry={entry}
            layerId={currentLayer}
            isSelected={currentSelections.has(entry.topic.topic_key)}
            onToggleSelection={onToggleSelection}
            clusterGroups={clusterGroups}
          />
        ));
      }
      
      // Too many topics: split topics by distance
      const closeTopics = topicEntries.filter(entry => 
        entry.proximityScore === null || entry.proximityScore <= 4.0
      );
      const distantTopics = topicEntries.filter(entry => 
        entry.proximityScore !== null && entry.proximityScore > 4.0
      );
      
      console.log(`🔍 Layer ${currentLayer} split: ${closeTopics.length} close topics, ${distantTopics.length} distant topics`);
      
      const renderTopic = (entry) => (
        <TopicItem
          key={entry.topic.topic_key}
          entry={entry}
          layerId={currentLayer}
          isSelected={currentSelections.has(entry.topic.topic_key)}
          onToggleSelection={onToggleSelection}
          clusterGroups={clusterGroups}
        />
      );
      
      return (
        <>
          {/* Close topics (distance <= 4.0) */}
          {closeTopics.map(renderTopic)}
          
          {/* Distant topics section */}
          {distantTopics.length > 0 && (
            <>
              <div className="distant-topics-divider">
                <h3>More distant from your selections ({distantTopics.length} topics)</h3>
              </div>
              {distantTopics.map(renderTopic)}
            </>
          )}
        </>
      );
    }
  };

  return (
    <div className="topics-grid">
      {/* Show previously banked topics as locked bricks */}
      {renderBankedTopics()}
      
      {/* Show current layer topics */}
      {renderCurrentLayerTopics()}
    </div>
  );
};

export default TopicsGrid;
