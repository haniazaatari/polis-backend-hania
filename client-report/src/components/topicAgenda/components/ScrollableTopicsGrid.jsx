import React, { useEffect, useState } from "react";
import TopicItem from "./TopicItem";
import { getFilteredTopics } from "../utils/topicFiltering";

const ScrollableTopicsGrid = ({ 
  topicData,
  selections,
  onToggleSelection,
  clusterGroups,
  hierarchyAnalysis 
}) => {
  const [dynamicLayers, setDynamicLayers] = useState([]);

  if (!topicData || !hierarchyAnalysis) return null;

  const runKeys = Object.keys(topicData.runs);
  const firstRun = topicData.runs[runKeys[0]];
  
  if (!firstRun.topics_by_layer) return null;

  // Get the two coarsest layers
  const sortedLayers = [...hierarchyAnalysis.layers].sort((a, b) => b - a);
  const coarsestLayer = sortedLayers[0];
  const secondCoarsestLayer = sortedLayers[1];

  // CRITICAL FEATURE: Auto-population based on second layer selections
  // ================================================================
  // The second coarsest layer is the KEY DRIVER for all subsequent layers!
  // 
  // DESIGN RATIONALE:
  // 1. The coarsest layer exists as a safety net - users can select broad topics and be done
  // 2. The SECOND coarsest layer is where the magic happens - it drives specificity
  // 3. When users select ANYTHING from the second layer, we auto-populate all finer layers
  //    with topics that are SPATIALLY NEAR (in UMAP space) to their selections
  // 
  // IMPLEMENTATION DETAILS:
  // - We watch for selections in the second coarsest layer
  // - When detected, we calculate spatial proximity using UMAP coordinates
  // - Topics within a certain distance threshold appear under "SUPER SPECIFIC TOPICS"
  // - This creates a progressive disclosure pattern that feels natural and exploratory
  // - The more they select in layer 2, the more refined their subsequent options become
  // 
  // WHY THIS MATTERS:
  // - Users don't get overwhelmed with ALL topics at once
  // - The interface adapts to their interests in real-time
  // - It feels like the system is "learning" what they care about
  // - Creates a natural funnel from broad → specific interests
  // ================================================================

  useEffect(() => {
    // Check if any topics from the second coarsest layer are selected
    const secondLayerSelections = Array.from(selections).filter(topicKey => {
      // Find which layer this topic belongs to
      const topic = Object.values(firstRun.topics_by_layer[secondCoarsestLayer] || {})
        .find(t => t.topic_key === topicKey);
      return !!topic;
    });

    if (secondLayerSelections.length === 0) {
      // No selections in second layer, hide dynamic layers
      setDynamicLayers([]);
      return;
    }

    // Build a map of selected topics from the second layer
    const selectedTopicsMap = new Map();
    selectedTopicsMap.set(secondCoarsestLayer, new Set(secondLayerSelections));

    // Get all finer layers (layers with lower numbers than secondCoarsestLayer)
    const finerLayers = sortedLayers.filter(layer => layer < secondCoarsestLayer);
    
    // Calculate which topics to show for each finer layer based on proximity
    const layersToShow = finerLayers.map(layerId => {
      const allTopics = firstRun.topics_by_layer[layerId] || {};
      const filteredTopics = getFilteredTopics(
        allTopics, 
        layerId, 
        hierarchyAnalysis, 
        selectedTopicsMap, 
        clusterGroups
      );

      // Only include layers that have close topics to show
      const closeTopics = filteredTopics.filter(entry => 
        entry.proximityScore !== null && entry.proximityScore < 2.5 // Tighter threshold for auto-population
      );

      return {
        layerId,
        topics: closeTopics,
        hasTopics: closeTopics.length > 0
      };
    }).filter(layer => layer.hasTopics);

    setDynamicLayers(layersToShow);
  }, [selections, secondCoarsestLayer, firstRun, hierarchyAnalysis, clusterGroups]);

  const renderLayerTopics = (layerId, layerLabel, topics = null) => {
    const layerTopics = topics || firstRun.topics_by_layer[layerId];
    if (!layerTopics) return null;

    const topicEntries = topics || Object.entries(layerTopics).map(([clusterId, topic]) => ({
      clusterId,
      topic,
      proximityScore: null,
      source: 'all'
    }));

    return (
      <React.Fragment key={layerId}>
        {layerLabel && (
          <div className="layer-divider">
            {layerLabel}
          </div>
        )}
        {topicEntries.map(entry => (
          <TopicItem
            key={entry.topic.topic_key}
            entry={entry}
            layerId={layerId}
            isSelected={selections.has(entry.topic.topic_key)}
            onToggleSelection={onToggleSelection}
            clusterGroups={clusterGroups}
          />
        ))}
      </React.Fragment>
    );
  };

  return (
    <div className="topics-scroll-container">
      <div className="topics-grid">
        {/* Always show coarsest layer first */}
        {renderLayerTopics(coarsestLayer, null)}
        
        {/* Show second coarsest layer if it exists */}
        {secondCoarsestLayer !== undefined && 
          renderLayerTopics(secondCoarsestLayer, "More Specific Topics")}
        
        {/* Dynamically show finer layers based on second layer selections */}
        {dynamicLayers.length > 0 && (
          <>
            {renderLayerTopics(
              dynamicLayers[0].layerId, 
              "SUPER SPECIFIC TOPICS",
              dynamicLayers[0].topics
            )}
            {/* Show even finer layers if they exist */}
            {dynamicLayers.slice(1).map((layer, index) => 
              renderLayerTopics(
                layer.layerId,
                `Ultra Specific Topics (Level ${index + 2})`,
                layer.topics
              )
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ScrollableTopicsGrid;