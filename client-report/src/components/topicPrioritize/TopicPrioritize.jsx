import React, { useState, useEffect, useRef } from "react";
import net from "../../util/net";
import { useReportId } from "../framework/useReportId";
import CommentList from "../lists/commentList.jsx";
import * as d3 from "d3";

const TopicPrioritize = ({ math, comments, conversation, ptptCount, formatTid, voteColors }) => {
  const { report_id } = useReportId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topicData, setTopicData] = useState(null);
  const [hierarchyAnalysis, setHierarchyAnalysis] = useState(null);
  const [currentLayer, setCurrentLayer] = useState(3); // Start with coarsest layer
  const [topicPriorities, setTopicPriorities] = useState(new Map()); // Store topic priorities
  const [selectedTopics, setSelectedTopics] = useState(new Set()); // Track selected topics for filtering

  useEffect(() => {
    if (!report_id) return;

    setLoading(true);
    // Fetch topic data from Delphi endpoint (same as CommentsReport)
    net
      .polisGet("/api/v3/delphi", {
        report_id: report_id,
      })
      .then((response) => {
        console.log("TopicMod topics response:", response);

        if (response && response.status === "success") {
          if (response.runs && Object.keys(response.runs).length > 0) {
            setTopicData(response);
            analyzeHierarchy(response);
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


  // Analyze if topics actually contain each other hierarchically
  const analyzeHierarchy = (data) => {
    // Get the first (most recent) run
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

    // For now, let's investigate what the data structure looks like
    const analysis = {
      hasHierarchy: false, // We'll determine this
      layers: layers,
      layerCounts: {},
      sampleTopics: {},
      totalComments: 0,
      structure: "unknown", // Will be "flat", "hierarchical", or "mixed"
      runInfo: {
        model_name: firstRun.model_name,
        created_at: firstRun.created_at,
        job_uuid: firstRun.job_uuid
      }
    };

    layers.forEach(layerId => {
      const topics = firstRun.topics_by_layer[layerId];
      analysis.layerCounts[layerId] = Object.keys(topics).length;
      
      // Take first few topics as samples
      analysis.sampleTopics[layerId] = Object.values(topics).slice(0, 3).map(topic => ({
        name: topic.topic_name,
        key: topic.topic_key,
        cluster_id: topic.cluster_id,
        model_name: topic.model_name
      }));
    });

    // Simple heuristic: if we have multiple layers with different counts,
    // it suggests some hierarchical structure
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

  // Set topic priority with cycling
  const cyclePriority = (topicKey) => {
    const currentPriority = topicPriorities.get(topicKey) || 'low';
    let nextPriority;
    
    switch (currentPriority) {
      case 'low': nextPriority = 'medium'; break;
      case 'medium': nextPriority = 'high'; break;
      case 'high': nextPriority = 'critical'; break; // spam
      case 'critical': nextPriority = 'low'; break; // back to start
      default: nextPriority = 'medium';
    }
    
    const newPriorities = new Map(topicPriorities);
    newPriorities.set(topicKey, nextPriority);
    setTopicPriorities(newPriorities);
    console.log(`Topic ${topicKey} cycled to ${nextPriority}`);
  };

  // Toggle topic selection for filtering
  const toggleTopicSelection = (topicKey) => {
    const newSelected = new Set(selectedTopics);
    if (newSelected.has(topicKey)) {
      newSelected.delete(topicKey);
    } else {
      newSelected.add(topicKey);
    }
    setSelectedTopics(newSelected);
  };

  // Get priority color
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'low': return '#d6d8db';
      case 'medium': return '#e2e6ea';
      case 'high': return '#d1d5db';
      case 'critical': return '#f0a7ab';
      default: return '#e9ecef';
    }
  };

  // Get priority indicator
  const getPriorityIndicator = (priority) => {
    switch (priority) {
      case 'low': return '· LOW';
      case 'medium': return '•• MEDIUM';
      case 'high': return '••• HIGH';
      case 'critical': return '🗑 SPAM/TRASH';
      default: return '· LOW';
    }
  };


  // Render dense priority selection for current layer
  const renderPriorityLayer = () => {
    if (!topicData || !topicData.runs || !hierarchyAnalysis) {
      return <div className="no-data">No topic data available</div>;
    }

    const runKeys = Object.keys(topicData.runs);
    const firstRun = topicData.runs[runKeys[0]];
    
    if (!firstRun.topics_by_layer || !firstRun.topics_by_layer[currentLayer]) {
      return <div className="no-data">No topics found for layer {currentLayer}</div>;
    }

    const topics = firstRun.topics_by_layer[currentLayer];
    const topicEntries = Object.entries(topics);
    
    return (
      <div className="priority-layer">
        <div className="layer-header">
          <h2>Layer {currentLayer} Community Impact</h2>
          <div className="layer-subtitle">
            {topicEntries.length} topics • Rate community impact and your expertise
          </div>
        </div>
        
        <div className="topics-grid">
          {topicEntries.map(([clusterId, topic]) => {
            const topicKey = topic.topic_key;
            const currentPriority = topicPriorities.get(topicKey) || 'low'; // Default to 'low'
            const isSelected = selectedTopics.has(topicKey);
            
            // Clean topic name
            let displayName = topic.topic_name;
            const layerClusterPrefix = `${currentLayer}_${clusterId}`;
            if (displayName && displayName.startsWith(layerClusterPrefix)) {
              displayName = displayName.substring(layerClusterPrefix.length).replace(/^:\s*/, '');
            }
            
            return (
              <div 
                key={topicKey} 
                className={`topic-item ${currentPriority}`}
                onClick={() => cyclePriority(topicKey)}
              >
                <div className="topic-content">
                  <div className="topic-header-row">
                    <span className="topic-id">{currentLayer}_{clusterId}</span>
                    <div className="priority-options">
                      {['low', 'medium', 'high', 'critical'].map(priority => (
                        <span 
                          key={priority}
                          className={`priority-option ${currentPriority === priority ? 'active' : ''}`}
                        >
                          {priority === 'low' ? 'LOW' : 
                           priority === 'medium' ? 'MEDIUM' : 
                           priority === 'high' ? 'HIGH' : 
                           'SPAM/TRASH'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="topic-text">{displayName || `Topic ${clusterId}`}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render layer navigation
  const renderLayerNavigation = () => {
    if (!hierarchyAnalysis) return null;

    return (
      <div className="layer-navigation">
        
        <div className="layer-tabs">
          {hierarchyAnalysis.layers.slice().reverse().map(layerId => (
            <button
              key={layerId}
              className={`layer-tab ${currentLayer === layerId ? 'active' : ''}`}
              onClick={() => setCurrentLayer(layerId)}
            >
              <div className="tab-number">L{layerId}</div>
              <div className="tab-label">
                {layerId === 3 ? 'Coarsest' : layerId === 0 ? 'Finest' : 'Mid'}
              </div>
              <div className="tab-count">{hierarchyAnalysis.layerCounts[layerId]}</div>
            </button>
          ))}
        </div>
        
        {selectedTopics.size > 0 && (
          <div className="selection-summary">
            <div className="selected-count">{selectedTopics.size} topics selected for filtering</div>
            <button 
              className="clear-selection"
              onClick={() => setSelectedTopics(new Set())}
            >
              Clear Selection
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render compact hierarchy analysis (moved to bottom)
  const renderCompactAnalysis = () => {
    if (!hierarchyAnalysis) return null;

    return (
      <div className="compact-analysis">
        <h4>Topic Structure Overview</h4>
        <div className="analysis-summary">
          <span className="structure-type">{hierarchyAnalysis.structure.toUpperCase()}</span>
          <span className="layer-breakdown">
            {hierarchyAnalysis.layers.map(layerId => 
              `L${layerId}:${hierarchyAnalysis.layerCounts[layerId]}`
            ).join(' • ')}
          </span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="topic-prioritize">
        <h1>Topic Prioritize</h1>
        <div className="loading">Loading topic data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="topic-prioritize">
        <h1>Topic Prioritize</h1>
        <div className="error-message">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="topic-prioritize">
      {renderLayerNavigation()}
      
      <div className="main-content">
        {renderPriorityLayer()}
      </div>


      <style jsx>{`
        .topic-prioritize {
          padding: 10px;
          max-width: 100%;
          margin: 0 auto;
          background: #f8f9fa;
          min-height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }


        .layer-navigation {
          background: white;
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }


        .layer-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .layer-tab {
          flex: 1;
          min-width: 80px;
          background: #f8f9fa;
          border: 2px solid #e9ecef;
          border-radius: 8px;
          padding: 10px 8px;
          cursor: pointer;
          text-align: center;
          transition: all 0.2s ease;
        }

        .layer-tab.active {
          background: #6c757d;
          border-color: #6c757d;
          color: white;
        }

        .layer-tab:hover {
          border-color: #6c757d;
          background: #f8f9fa;
        }

        .tab-number {
          font-weight: 700;
          font-size: 1.1rem;
        }

        .tab-label {
          font-size: 0.75rem;
          margin: 2px 0;
        }

        .tab-count {
          font-size: 0.8rem;
          opacity: 0.8;
        }

        .selection-summary {
          margin-top: 15px;
          padding: 10px;
          background: #e3f2fd;
          border-radius: 6px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .selected-count {
          font-size: 0.9rem;
          color: #1e7dff;
          font-weight: 500;
        }

        .clear-selection {
          background: #ff4757;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.8rem;
        }

        .main-content {
          margin-bottom: 8px;
        }

        .priority-layer {
          background: white;
          border-radius: 8px;
          padding: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .layer-header h2 {
          margin: 0 0 3px 0;
          color: #333;
          font-size: 1.2rem;
        }

        .layer-subtitle {
          color: #666;
          font-size: 0.85rem;
          margin-bottom: 12px;
        }

        .topics-grid {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .topic-item {
          background: white;
          border-left: 6px solid #e9ecef;
          padding: 8px 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          margin-bottom: 2px;
        }

        .topic-item:hover {
          background: #f8f9fa;
        }

        .topic-item.low {
          border-left-color: #dee2e6;
        }

        .topic-item.medium {
          border-left-color: #6c757d;
        }

        .topic-item.high {
          border-left-color: #343a40;
        }

        .topic-item.critical {
          border-left-color: #dc3545;
        }

        .topic-content {
          width: 100%;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        }

        .topic-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }

        .topic-id {
          color: #6c757d;
          font-size: 0.8rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          min-width: 40px;
        }

        .priority-options {
          display: flex;
          gap: 6px;
        }

        .priority-option {
          font-size: 0.65rem;
          color: #dee2e6;
          font-weight: 500;
          padding: 1px 3px;
          border-radius: 2px;
          transition: all 0.15s ease;
          letter-spacing: 0.01em;
        }

        .priority-option.active {
          font-weight: 700;
        }

        .priority-option:nth-child(1).active {
          background: #f8f9fa;
          color: #adb5bd;
        }

        .priority-option:nth-child(2).active {
          background: #6c757d;
          color: white;
        }

        .priority-option:nth-child(3).active {
          background: #343a40;
          color: white;
        }

        .priority-option:nth-child(4).active {
          background: #dc3545;
          color: white;
        }

        .topic-text {
          color: #212529;
          font-size: 1.1rem;
          line-height: 1.3;
          font-weight: 500;
          margin: 0;
          letter-spacing: -0.01em;
        }


        .no-data {
          text-align: center;
          padding: 40px;
          color: #666;
          font-style: italic;
        }

        .loading, .error-message {
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .error-message {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .loading {
          font-size: 1.1rem;
          color: #666;
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .topics-grid {
            grid-template-columns: 1fr;
          }
          
          .layer-tabs {
            justify-content: center;
          }
          
          .layer-tab {
            min-width: 70px;
          }
          
          .compact-header h1 {
            font-size: 1.5rem;
          }
          
          .analysis-summary {
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  );
};

export default TopicPrioritize;