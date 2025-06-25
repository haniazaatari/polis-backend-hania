import React, { useState, useEffect } from "react";
import net from "../../util/net";
import { useReportId } from "../framework/useReportId";

const TopicAgenda = ({ conversation }) => {
  const { report_id } = useReportId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topicData, setTopicData] = useState(null);
  const [hierarchyAnalysis, setHierarchyAnalysis] = useState(null);
  const [currentLayer, setCurrentLayer] = useState(null); // Will be set to highest available layer
  const [bankedTopics, setBankedTopics] = useState(new Map()); // layerId -> Set of topic keys
  const [currentSelections, setCurrentSelections] = useState(new Set()); // Current layer selections
  const [umapData, setUmapData] = useState(null); 
  const [clusterGroups, setClusterGroups] = useState({}); 
  const [completedLayers, setCompletedLayers] = useState(new Set()); // Layers that have been banked
  
  useEffect(() => {
    if (!report_id) return;

    setLoading(true);
    // Fetch topic data from Delphi endpoint
    net
      .polisGet("/api/v3/delphi", {
        report_id: report_id,
      })
      .then((response) => {
        console.log("TopicAgenda topics response:", response);

        if (response && response.status === "success") {
          if (response.runs && Object.keys(response.runs).length > 0) {
            setTopicData(response);
            analyzeHierarchy(response);
            fetchUMAPData();
          } else {
            setError("No LLM topic data available yet. Run Delphi analysis first.");
          }
        } else {
          setError("Failed to retrieve topic data");
        }

        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching topic data:", err);
        setError("Failed to connect to the topicMod endpoint");
        setLoading(false);
      });
  }, [report_id]);

  // Fetch UMAP coordinates for spatial filtering (reused from TopicPrioritize)
  const fetchUMAPData = async () => {
    try {
      const conversationId = conversation?.conversation_id || report_id;
      console.log("Fetching UMAP data for spatial filtering...");
      
      const response = await fetch(`/api/v3/topicMod/proximity?conversation_id=${conversationId}&layer_id=all`);
      const data = await response.json();
      
      if (data.status === "success" && data.proximity_data) {
        console.log(`Loaded ${data.proximity_data.length} UMAP points for spatial filtering`);
        setUmapData(data.proximity_data);
        
        
        // Group points by layer and cluster
        const groups = groupPointsByLayer(data.proximity_data);
        setClusterGroups(groups);
        
        console.log("UMAP cluster groups:", groups);
      } else {
        console.log("No UMAP data available for spatial filtering");
      }
    } catch (err) {
      console.error("Error fetching UMAP data:", err);
    }
  };

  // Group UMAP points by layer and cluster (reused from TopicPrioritize)
  const groupPointsByLayer = (data) => {
    const groups = {};
    const allClusterIds = new Set();
    
    for (let layer = 0; layer <= 3; layer++) {
      groups[layer] = new Map();
    }
    
    data.forEach(point => {
      Object.entries(point.clusters || {}).forEach(([layerId, clusterId]) => {
        const layer = parseInt(layerId);
        const key = `${layer}_${clusterId}`;
        
        if (layer === 0) {
          allClusterIds.add(clusterId);
        }
        
        if (!groups[layer].has(key)) {
          groups[layer].set(key, []);
        }
        
        groups[layer].get(key).push({
          comment_id: point.comment_id,
          cluster_id: clusterId,
          layer: layer,
          umap_x: point.umap_x,
          umap_y: point.umap_y,
          weight: point.weight || 1
        });
      });
    });
    
    
    return groups;
  };

  // Analyze hierarchy and set starting layer (reused from TopicPrioritize)
  const analyzeHierarchy = (data) => {
    const runKeys = Object.keys(data.runs);
    if (runKeys.length === 0) {
      setHierarchyAnalysis({ hasHierarchy: false, reason: "No runs data" });
      return;
    }

    const firstRun = data.runs[runKeys[0]];
    if (!firstRun.topics_by_layer) {
      setHierarchyAnalysis({ hasHierarchy: false, reason: "No topics_by_layer data in run" });
      return;
    }

    const layers = Object.keys(firstRun.topics_by_layer).map(k => parseInt(k)).sort((a, b) => a - b);
    console.log("Analyzing layers:", layers);
    
    // Set current layer to the highest available layer if not set
    if (currentLayer === null && layers.length > 0) {
      const maxLayer = Math.max(...layers);
      setCurrentLayer(maxLayer);
      console.log(`Setting current layer to highest available: ${maxLayer}`);
    }

    const analysis = {
      hasHierarchy: false, 
      layers: layers,
      layerCounts: {},
      sampleTopics: {},
      totalComments: 0,
      structure: "unknown", 
      runInfo: {
        model_name: firstRun.model_name,
        created_at: firstRun.created_at,
        job_uuid: firstRun.job_uuid
      }
    };

    layers.forEach(layerId => {
      const topics = firstRun.topics_by_layer[layerId];
      analysis.layerCounts[layerId] = Object.keys(topics).length;
      
      analysis.sampleTopics[layerId] = Object.values(topics).slice(0, 3).map(topic => ({
        name: topic.topic_name,
        key: topic.topic_key,
        cluster_id: topic.cluster_id,
        model_name: topic.model_name
      }));
    });

    const counts = Object.values(analysis.layerCounts);
    const hasVariedCounts = Math.max(...counts) !== Math.min(...counts);
    
    if (hasVariedCounts && layers.length > 1) {
      analysis.hasHierarchy = true;
      analysis.structure = "hierarchical";
      analysis.reason = `Found ${layers.length} layers with varying topic counts: ${counts.join(", ")}`;
    } else if (layers.length === 1) {
      analysis.structure = "flat";
      analysis.reason = "Only one layer found - flat structure";
    } else {
      analysis.structure = "unclear";
      analysis.reason = "Multiple layers but similar counts - unclear hierarchy";
    }

    console.log("Hierarchy analysis:", analysis);
    setHierarchyAnalysis(analysis);
  };

  // Calculate cluster centroid in UMAP space (reused from TopicPrioritize)
  const calculateClusterCentroid = (clusterPoints) => {
    if (!clusterPoints || clusterPoints.length === 0) return null;
    const centroidX = clusterPoints.reduce((sum, p) => sum + p.umap_x, 0) / clusterPoints.length;
    const centroidY = clusterPoints.reduce((sum, p) => sum + p.umap_y, 0) / clusterPoints.length;
    return { x: centroidX, y: centroidY };
  };

  // Calculate Euclidean distance between two points (reused from TopicPrioritize)
  const calculateDistance = (point1, point2) => {
    return Math.sqrt(
      Math.pow(point1.x - point2.x, 2) + 
      Math.pow(point1.y - point2.y, 2)
    );
  };

  // Get comment count for a cluster (reused from TopicPrioritize)
  const getCommentCount = (layerId, clusterId) => {
    const clusterKey = `${layerId}_${clusterId}`;
    const points = clusterGroups[layerId]?.get(clusterKey);
    return points ? points.length : 0;
  };

  // Toggle topic selection for current layer
  const toggleTopicSelection = (topicKey) => {
    const newSelections = new Set(currentSelections);
    if (newSelections.has(topicKey)) {
      newSelections.delete(topicKey);
    } else {
      newSelections.add(topicKey);
    }
    setCurrentSelections(newSelections);
  };

  // Bank selected topics and move to next layer
  const bankAndClear = () => {
    if (currentSelections.size === 0) {
      alert("Please select at least one topic to bank before proceeding.");
      return;
    }

    // Bank the current selections
    const newBankedTopics = new Map(bankedTopics);
    newBankedTopics.set(currentLayer, new Set(currentSelections));
    setBankedTopics(newBankedTopics);
    
    // Mark current layer as completed
    const newCompletedLayers = new Set(completedLayers);
    newCompletedLayers.add(currentLayer);
    setCompletedLayers(newCompletedLayers);

    // Clear current selections
    setCurrentSelections(new Set());

    // Move to next layer (lower number = finer granularity)
    const nextLayer = currentLayer - 1;
    const minLayer = hierarchyAnalysis ? Math.min(...hierarchyAnalysis.layers) : 0;
    
    if (nextLayer >= minLayer && hierarchyAnalysis && hierarchyAnalysis.layers.includes(nextLayer)) {
      setCurrentLayer(nextLayer);
      console.log(`Banked ${currentSelections.size} topics from Layer ${currentLayer}, moving to Layer ${nextLayer}`);
      
    } else {
      // Set currentLayer to null to indicate completion
      setCurrentLayer(null);
      console.log(`Agenda building complete! Banked topics from ${newCompletedLayers.size} layers.`);
    }
  };

  // Reset the entire process
  const resetAgenda = () => {
    setBankedTopics(new Map());
    setCurrentSelections(new Set());
    setCompletedLayers(new Set());
    if (hierarchyAnalysis && hierarchyAnalysis.layers.length > 0) {
      const maxLayer = Math.max(...hierarchyAnalysis.layers);
      setCurrentLayer(maxLayer);
    }
  };

  // Get layer background shade based on layer number
  const getLayerBackgroundShade = (layerId, isCompleted = false) => {
    const maxLayer = hierarchyAnalysis ? Math.max(...hierarchyAnalysis.layers) : 3;
    const minLayer = hierarchyAnalysis ? Math.min(...hierarchyAnalysis.layers) : 0;
    const range = maxLayer - minLayer;
    
    // Calculate shade intensity (higher layers = darker)
    const intensity = range > 0 ? ((layerId - minLayer) / range) : 0.5;
    const grayValue = Math.floor(240 + (intensity * 15)); // Range from 240 to 255
    
    if (isCompleted) {
      // Completed layers get a slight blue tint
      return `rgba(${grayValue - 10}, ${grayValue - 5}, ${grayValue}, 0.8)`;
    } else {
      return `rgb(${grayValue}, ${grayValue}, ${grayValue})`;
    }
  };

  // Get filtered topics for current layer based on spatial proximity to banked topics
  const getFilteredTopics = (allTopics, layerId) => {
    
    const maxLayer = hierarchyAnalysis ? Math.max(...hierarchyAnalysis.layers) : layerId;
    
    if (layerId === maxLayer || bankedTopics.size === 0) {
      return Object.entries(allTopics).map(([clusterId, topic]) => ({
        clusterId,
        topic,
        proximityScore: null,
        source: 'all'
      }));
    }

    // For subsequent layers, filter based on proximity to banked topics
    // TODO: Implement sophisticated edge detection for topics far from ALL banked topics
    // For now, using simple distance-based approach from TopicPrioritize
    
    const higherLayerId = layerId + 1;
    const bankedFromHigherLayer = bankedTopics.get(higherLayerId);
    
    if (!bankedFromHigherLayer || !clusterGroups[higherLayerId] || !clusterGroups[layerId]) {
      return Object.entries(allTopics).map(([clusterId, topic]) => ({
        clusterId,
        topic,
        proximityScore: null,
        source: 'all'
      }));
    }

    // Calculate proximity to banked topics
    const adaptiveDistance = 4.0;
    
    const topicsWithProximity = Object.entries(allTopics).map(([clusterId, topic]) => {
      const clusterKey = `${layerId}_${clusterId}`;
      const targetPoints = clusterGroups[layerId].get(clusterKey);
      
      let minProximity = Infinity;
      let closestBankedTopic = null;
      
      if (targetPoints && targetPoints.length > 0) {
        const targetCentroid = calculateClusterCentroid(targetPoints);
        if (targetCentroid) {
          // Check distance to each banked topic
          bankedFromHigherLayer.forEach(bankedTopicKey => {
            // Extract cluster info from topic key - handle complex format like "2_4c5b018b-51ac-4a3e-9d41-6307a73ebf68#2#6"
            // Look for the pattern after the last '#' or the number after the first '_'
            let bankedClusterId;
            if (bankedTopicKey.includes('#')) {
              // Format: "2_uuid#2#6" -> clusterId = "6"  
              const parts = bankedTopicKey.split('#');
              bankedClusterId = parts[parts.length - 1];
            } else if (bankedTopicKey.includes('_')) {
              // Format: "2_6" -> clusterId = "6"
              const parts = bankedTopicKey.split('_');
              bankedClusterId = parts[parts.length - 1];
            }
            
            const bankedClusterKey = `${higherLayerId}_${bankedClusterId}`;
            const bankedPoints = clusterGroups[higherLayerId].get(bankedClusterKey);
            
            if (bankedPoints && bankedPoints.length > 0) {
              const bankedCentroid = calculateClusterCentroid(bankedPoints);
              if (bankedCentroid) {
                const distance = calculateDistance(targetCentroid, bankedCentroid);
                if (distance < minProximity) {
                  minProximity = distance;
                  closestBankedTopic = bankedClusterKey;
                }
              }
            }
          });
        }
      }
      
      const finalScore = minProximity === Infinity ? null : minProximity;
      
      // TOFIX: 0_0 and other low-numbered clusters are hidden because there's a data structure mismatch 
      // between Delphi topics and UMAP spatial data grouping. Topics exist in both systems but
      // the key lookup in clusterGroups is failing for clusters 0,1,4,6,7,9,10,11,52,65,103,111,119,124
      
      return {
        clusterId,
        topic,
        proximityScore: finalScore,
        closestBankedTopic: closestBankedTopic,
        source: (minProximity !== Infinity && minProximity <= adaptiveDistance) ? 'close' : 'far'
      };
    });


    // For coarsest and second coarsest layers: show all topics, just sort by proximity
    // For finest layers: apply the proximity filtering and hide nulls
    let filteredTopics;
    if (layerId === maxLayer - 1) {
      // Second coarsest layer: show all topics
      filteredTopics = topicsWithProximity;
    } else {
      // Finest layers: apply proximity filtering and hide topics without distance data
      filteredTopics = topicsWithProximity.filter(item => 
        item.source === 'close'
      );
    }
    
    // Sort by proximity score (closest first, then nulls at end)
    const sortedTopics = filteredTopics.sort((a, b) => {
      if (a.proximityScore === null && b.proximityScore === null) return 0;
      if (a.proximityScore === null) return 1;
      if (b.proximityScore === null) return -1;
      return a.proximityScore - b.proximityScore;
    });
    
    return sortedTopics;
  };

  // Auto-select close topics when layer changes
  useEffect(() => {
    if (!topicData || !hierarchyAnalysis || currentLayer === null || bankedTopics.size === 0) {
      return;
    }

    const runKeys = Object.keys(topicData.runs);
    const firstRun = topicData.runs[runKeys[0]];
    const allTopics = firstRun.topics_by_layer[currentLayer];
    
    if (allTopics) {
      const topicEntries = getFilteredTopics(allTopics, currentLayer);
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
  }, [currentLayer, bankedTopics.size]); // Trigger when layer changes and we have banked topics

  // Render current layer topics
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
    const topicEntries = getFilteredTopics(allTopics, currentLayer);
    const isCompleted = completedLayers.has(currentLayer);
    const layerBg = getLayerBackgroundShade(currentLayer, isCompleted);
    const totalTopicsCount = Object.keys(allTopics).length;
    
    return (
      <div className="current-layer">
        <div className="layer-header">
          <h1>Which topics are highest priority?</h1>
          
          <div className="call-to-action">
            Choose critical topics you want discussed more - topics you think are important overall, topics you might think about a lot or even be an expert in! Help drive the overall agenda. You can come back and change these any time, and the options will change as the conversation grows - and as you submit comments yourself!
          </div>
          
          <div className="button-group">
            <div className="step-and-button">
              <h2>
                Step {completedLayers.size + 1} of {hierarchyAnalysis.layers.length}: {currentLayer === Math.max(...hierarchyAnalysis.layers) ? 'Coarsest' : 
                 currentLayer === Math.min(...hierarchyAnalysis.layers) ? 'Finest Grain' : 'Mid'} Topics <span className="selection-count">({currentSelections.size} selected of {topicEntries.length} close enough to show{currentLayer === Math.min(...hierarchyAnalysis.layers) ? ` out of ${totalTopicsCount} total finest grain` : ''})</span>
              </h2>
              <div className="action-buttons">
                <button className="reset-button" onClick={resetAgenda}>
                  Reset
                </button>
                <button 
                  className={`bank-button ${currentSelections.size === 0 ? 'disabled' : ''}`} 
                  onClick={bankAndClear}
                  disabled={currentSelections.size === 0}
                >
                  {currentSelections.size === 0 ? 
                    'Select topics to continue' : 
                    `Bank ${currentSelections.size} Selected Topics & Continue`
                  }
                </button>
              </div>
            </div>
            
            {/* Submit button - only show on final layer */}
            {currentLayer === Math.min(...hierarchyAnalysis.layers) && (
              <button 
                className={`submit-finish-button ${completedLayers.size === 0 ? 'disabled' : ''}`}
                disabled={completedLayers.size === 0}
              >
                Submit & Finish
              </button>
            )}
          </div>
          
        </div>
        
        <div className="topics-grid">
          {/* Show previously banked topics as locked bricks */}
          {Array.from(bankedTopics.entries()).map(([layerId, topicKeys]) => {
            if (layerId === currentLayer) return null; // Don't show current layer banked topics here
            
            const layerTopics = firstRun.topics_by_layer[layerId];
            return Array.from(topicKeys).map(topicKey => {
              const topic = Object.values(layerTopics).find(t => t.topic_key === topicKey);
              if (!topic) return null;
              
              const parts = topicKey.split('_');
              const clusterId = parts[parts.length - 1];
              let displayName = topic.topic_name;
              const layerClusterPrefix = `${layerId}_${clusterId}`;
              if (displayName && displayName.startsWith(layerClusterPrefix)) {
                displayName = displayName.substring(layerClusterPrefix.length).replace(/^:\s*/, '');
              }
              
              return (
                <div key={topicKey} className="topic-item banked-brick">
                  <div className="topic-content">
                    <span className="topic-text">{displayName}</span>
                    <input type="checkbox" checked={true} disabled className="topic-checkbox" />
                  </div>
                </div>
              );
            });
          })}
          
          {/* Show current layer topics */}
          {topicEntries.map((entry) => {
            const { clusterId, topic, proximityScore, closestBankedTopic, source } = entry;
            const topicKey = topic.topic_key;
            const isSelected = currentSelections.has(topicKey);
            const commentCount = getCommentCount(currentLayer, clusterId);
            
            // Clean topic name
            let displayName = topic.topic_name;
            const layerClusterPrefix = `${currentLayer}_${clusterId}`;
            if (displayName && displayName.startsWith(layerClusterPrefix)) {
              displayName = displayName.substring(layerClusterPrefix.length).replace(/^:\s*/, '');
            }
            
            return (
              <div 
                key={topicKey} 
                className={`topic-item ${isSelected ? 'selected brick' : 'unselected'}`}
                onClick={() => toggleTopicSelection(topicKey)}
              >
                <div className="topic-content">
                  <span className="topic-id-hidden">{currentLayer}_{clusterId} ({commentCount} comments)</span>
                  {proximityScore !== null && closestBankedTopic && (
                    <span className="proximity-info-hidden"> (d: {proximityScore.toFixed(3)} from {closestBankedTopic.replace('_', '_')})</span>
                  )}
                  <span className="topic-text">{displayName || `Topic ${clusterId}`}</span>
                  {proximityScore !== null && (
                    <span className="distance-display" style={{fontSize: '0.8rem', color: '#666', marginLeft: '8px'}}>
                      d: {proximityScore.toFixed(2)}
                    </span>
                  )}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}} // onClick on parent handles it
                    className="topic-checkbox"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render banked topics from completed layers
  const renderBankedTopics = () => {
    if (bankedTopics.size === 0) return null;

    const runKeys = Object.keys(topicData.runs);
    const firstRun = topicData.runs[runKeys[0]];

    return (
      <div className="banked-topics">
        <h3>Your Selected Topics</h3>
        {Array.from(bankedTopics.entries())
          .sort(([a], [b]) => b - a) // Sort by layer descending
          .map(([layerId, topicKeys]) => {
            const layerTopics = firstRun.topics_by_layer[layerId];
            const layerLabel = layerId === Math.max(...hierarchyAnalysis.layers) ? 'Broad' : 
                              layerId === Math.min(...hierarchyAnalysis.layers) ? 'Specific' : 'Mid-level';
            
            return (
              <div key={layerId} className="banked-layer">
                <h4>{layerLabel} Topics ({topicKeys.size} selected)</h4>
                <div className="banked-topics-list">
                  {Array.from(topicKeys).map(topicKey => {
                    const topic = Object.values(layerTopics).find(t => t.topic_key === topicKey);
                    if (!topic) return null;
                    
                    let displayName = topic.topic_name;
                    const parts = topicKey.split('_');
                    const clusterId = parts[parts.length - 1];
                    const layerClusterPrefix = `${layerId}_${clusterId}`;
                    if (displayName && displayName.startsWith(layerClusterPrefix)) {
                      displayName = displayName.substring(layerClusterPrefix.length).replace(/^:\s*/, '');
                    }
                    
                    return (
                      <div key={topicKey} className="banked-topic">
                        <span className="topic-text">{displayName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    );
  };

  // Render progress and controls
  const renderControls = () => {
    if (!hierarchyAnalysis) return null;

    const totalLayers = hierarchyAnalysis.layers.length;
    const completedCount = completedLayers.size;
    const isComplete = completedCount === totalLayers || currentLayer < Math.min(...hierarchyAnalysis.layers);
    
    return (
      <div className="controls">
        <div className="progress">
          <h3>Agenda Building Progress</h3>
          <div className="progress-text">
            {isComplete ? 
              `✅ Complete! Agenda built from ${completedCount} steps.` :
              `Step ${completedCount + 1} of ${totalLayers}`
            }
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${(completedCount / totalLayers) * 100}%` }}
            ></div>
          </div>
        </div>
        
        <div className="control-buttons">
          <button className="reset-button" onClick={resetAgenda}>
            Start Over
          </button>
          {isComplete && (
            <button className="export-button">
              Export Agenda (Coming Soon)
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="topic-agenda">
        <h1>Topic Agenda Builder</h1>
        <div className="loading">Loading topic data...</div>
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
      </div>
    );
  }

  return (
    <div className="topic-agenda">
      {renderCurrentLayer()}

      <style jsx>{`
        .topic-agenda {
          padding: 20px;
          max-width: 1200px;
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .header {
          text-align: center;
          margin-bottom: 30px;
        }

        .header h1 {
          margin: 0 0 10px 0;
          color: #333;
          font-size: 2.2rem;
        }

        .subtitle {
          color: #666;
          font-size: 1.1rem;
          margin: 0;
          max-width: 600px;
          margin: 0 auto;
        }

        .controls {
          background: white;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .progress h3 {
          margin: 0 0 10px 0;
          color: #333;
        }

        .progress-text {
          color: #666;
          margin-bottom: 15px;
          font-size: 1rem;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #e9ecef;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 20px;
        }

        .progress-fill {
          height: 100%;
          background: #03a9f4;
          transition: width 0.3s ease;
        }

        .control-buttons {
          display: flex;
          gap: 10px;
        }

        .reset-button, .export-button, .submit-button, .restart-button {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }

        .reset-button, .restart-button {
          background: #6c757d;
          color: white;
        }

        .reset-button:disabled {
          background: #bbb;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .export-button {
          background: #007bff;
          color: white;
        }

        .submit-button {
          background: #28a745;
          color: white;
          font-size: 1.1rem;
          padding: 15px 30px;
          margin-right: 15px;
        }

        .completion-screen {
          text-align: center;
          padding: 40px 20px;
        }

        .completion-header h1 {
          color: #28a745;
          margin-bottom: 15px;
        }

        .completion-summary {
          color: #666;
          font-size: 1.1rem;
          margin-bottom: 30px;
        }

        .completion-actions {
          margin: 30px 0;
        }

        .final-agenda-summary {
          margin-top: 40px;
          text-align: left;
        }

        .banked-topics {
          margin-bottom: 20px;
        }

        .banked-topics h3 {
          margin: 0 0 15px 0;
          color: #333;
        }

        .banked-layer {
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 10px;
          border: 1px solid #dee2e6;
        }

        .banked-layer h4 {
          margin: 0 0 10px 0;
          color: #495057;
          font-size: 1rem;
        }

        .banked-topics-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 8px;
        }

        .banked-topic {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          background: rgba(255,255,255,0.7);
          border-radius: 4px;
          font-size: 0.9rem;
        }

        .current-layer {
          padding: 20px;
          margin-bottom: 20px;
        }

        .layer-header {
          margin-bottom: 20px;
        }

        .step-section {
          margin-bottom: 15px;
        }

        .progress-bar-inline {
          display: inline-block;
          width: 80px;
          height: 6px;
          background: #e9ecef;
          border-radius: 3px;
          overflow: hidden;
          margin-left: 10px;
          vertical-align: middle;
        }

        .call-to-action {
          color: #555;
          font-size: 1rem;
          margin: 10px 0 15px 0;
          line-height: 1.4;
        }

        .selection-status {
          color: #666;
          font-size: 0.9rem;
          margin-bottom: 15px;
          font-weight: 500;
        }

        .layer-header h1 {
          margin: 0 0 12px 0;
          color: #333;
          font-size: 1.5rem;
          font-weight: 600;
        }

        .layer-header h2 {
          margin: 0 0 8px 0;
          color: #333;
          font-size: 1.2rem;
        }

        .layer-subtitle {
          color: #666;
          font-size: 0.95rem;
          margin-bottom: 15px;
        }

        .button-group {
          display: flex;
          gap: 15px;
          align-items: flex-end;
        }

        .step-and-button {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .step-and-button h2 {
          margin: 0;
        }

        .selection-count {
          font-weight: 300;
          font-style: italic;
        }

        .action-buttons {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .bank-button, .submit-finish-button {
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 1rem;
        }

        .bank-button {
          background: #03a9f4;
          color: white;
        }

        .bank-button:hover:not(.disabled) {
          background: #0288d1;
        }

        .bank-button.disabled {
          background: #bbb;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .submit-finish-button {
          background: #28a745;
          color: white;
        }

        .submit-finish-button:hover:not(.disabled) {
          background: #218838;
        }

        .submit-finish-button.disabled {
          background: #bbb;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .topics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 10px;
        }

        .topic-item {
          background: white;
          border: 2px solid #e9ecef;
          border-radius: 6px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .topic-item:hover {
          border-color: #adb5bd;
          background: #f8f9fa;
        }

        .topic-item.selected.brick {
          border-color: #03a9f4;
          background: #e1f5fe;
          opacity: 1;
          transition: all 0.3s ease;
        }

        .topic-item.banked-brick {
          border-color: #03a9f4;
          background: #e1f5fe;
          opacity: 1;
          cursor: default;
        }


        .topic-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: 100%;
        }

        .topic-id {
          color: #6c757d;
          font-size: 0.8rem;
          font-weight: 600;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }

        .topic-id-hidden {
          visibility: hidden;
          position: absolute;
          left: -9999px;
          color: #6c757d;
          font-size: 0.7rem;
          font-weight: 400;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }

        .proximity-info-hidden {
          visibility: hidden;
          position: absolute;
          left: -9999px;
          color: #6c757d;
          font-size: 0.7rem;
          font-weight: 400;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }

        .source-indicator {
          margin-left: 5px;
          font-size: 0.8rem;
        }

        .topic-checkbox {
          transform: scale(1.2);
          cursor: pointer;
        }

        .topic-text {
          color: #212529;
          font-size: 1rem;
          line-height: 1.3;
          font-weight: 500;
          flex: 1;
        }

        .no-data, .loading, .error-message {
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 8px;
          margin: 20px 0;
        }

        .error-message {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .topic-agenda {
            padding: 15px;
          }
          
          .topics-grid, .banked-topics-list {
            grid-template-columns: 1fr;
          }
          
          .header h1 {
            font-size: 1.8rem;
          }
          
          .control-buttons {
            flex-direction: column;
          }
          
          .topic-header-row {
            flex-direction: column;
            align-items: flex-start;
            gap: 5px;
          }
        }
      `}</style>
    </div>
  );
};

export default TopicAgenda;