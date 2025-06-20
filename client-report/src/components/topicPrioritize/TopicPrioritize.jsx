import React, { useState, useEffect } from "react";
import net from "../../util/net";
import { useReportId } from "../framework/useReportId";
import CommentList from "../lists/commentList.jsx";

const TopicPrioritize = ({ math, comments, conversation, ptptCount, formatTid, voteColors }) => {
  const { report_id } = useReportId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topicData, setTopicData] = useState(null);
  const [selectedComments, setSelectedComments] = useState(new Set());
  const [hierarchyAnalysis, setHierarchyAnalysis] = useState(null);
  const [showAllLayers, setShowAllLayers] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState(0);

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

  // Toggle comment selection
  const toggleCommentSelection = (commentId) => {
    const newSelected = new Set(selectedComments);
    if (newSelected.has(commentId)) {
      newSelected.delete(commentId);
    } else {
      newSelected.add(commentId);
    }
    setSelectedComments(newSelected);
  };

  // Select all comments in a topic/cluster
  const selectAllInTopic = (topicKey) => {
    // This would need to fetch comments for the specific topic
    console.log("Would select all comments in topic:", topicKey);
  };

  // Render dense comment list for a layer
  const renderCommentsForLayer = (layerId) => {
    if (!topicData || !topicData.runs) {
      return <p>No data available</p>;
    }

    const runKeys = Object.keys(topicData.runs);
    const firstRun = topicData.runs[runKeys[0]];
    
    if (!firstRun.topics_by_layer || !firstRun.topics_by_layer[layerId]) {
      return <p>No topics found for layer {layerId}</p>;
    }

    const topics = firstRun.topics_by_layer[layerId];
    
    return (
      <div className="layer-section">
        <h3>Layer {layerId} ({Object.keys(topics).length} topics)</h3>
        
        {Object.entries(topics).map(([clusterId, topic]) => (
          <div key={`${layerId}-${clusterId}`} className="topic-section">
            <div className="topic-header">
              <h4>{topic.topic_name}</h4>
              <div className="topic-controls">
                <label>
                  <input
                    type="checkbox"
                    onChange={() => selectAllInTopic(topic.topic_key)}
                  />
                  Select all in topic
                </label>
                <span className="topic-info">
                  Cluster {clusterId} | Status: {topic.moderation?.status || 'pending'}
                </span>
              </div>
            </div>
            
            <div className="topic-comments">
              <p className="coming-soon">
                [Dense comment list for this topic would go here]
                <br />
                <small>
                  Topic key: {topic.topic_key}<br />
                  Model: {topic.model_name}<br />
                  Comments: {topic.moderation?.comment_count || 'unknown'}
                </small>
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render circle pack visualization hint
  const renderCirclePackHint = () => {
    if (!hierarchyAnalysis) return null;

    return (
      <div className="hierarchy-analysis">
        <h3>Hierarchy Analysis</h3>
        <div className={`analysis-result ${hierarchyAnalysis.hasHierarchy ? 'hierarchical' : 'flat'}`}>
          <h4>Structure: {hierarchyAnalysis.structure}</h4>
          <p>{hierarchyAnalysis.reason}</p>
          
          {hierarchyAnalysis.hasHierarchy && (
            <div className="circle-pack-suggestion">
              <h5>🎯 Circle Pack Visualization Opportunity!</h5>
              <p>
                Since we have hierarchical structure, this could be visualized as a circle pack where:
              </p>
              <ul>
                <li>Larger circles represent coarser layers (layer {Math.max(...hierarchyAnalysis.layers)})</li>
                <li>Smaller circles nested inside represent finer layers (layer {Math.min(...hierarchyAnalysis.layers)})</li>
                <li>Circle size could represent comment count or engagement</li>
                <li>Color could represent moderation status or sentiment</li>
              </ul>
            </div>
          )}
          
          <div className="layer-summary">
            <h5>Layer Summary:</h5>
            {hierarchyAnalysis.layers.map(layerId => (
              <div key={layerId} className="layer-info">
                <strong>Layer {layerId}:</strong> {hierarchyAnalysis.layerCounts[layerId]} topics
                <div className="sample-topics">
                  {hierarchyAnalysis.sampleTopics[layerId]?.map((topic, idx) => (
                    <span key={idx} className="topic-sample">"{topic.name}"</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
      <div className="header">
        <h1>Topic Prioritize</h1>
        <div className="subtitle">
          Dense view of all comments organized by hierarchical topics
        </div>
        <div className="report-info">Report ID: {report_id}</div>
      </div>

      {renderCirclePackHint()}

      <div className="controls">
        <div className="layer-controls">
          <h3>Layer Selection</h3>
          <label>
            <input
              type="radio"
              name="layer-selection"
              checked={showAllLayers}
              onChange={() => setShowAllLayers(true)}
            />
            Show all layers
          </label>
          
          {hierarchyAnalysis?.layers.map(layerId => (
            <label key={layerId}>
              <input
                type="radio"
                name="layer-selection"
                checked={!showAllLayers && selectedLayer === layerId}
                onChange={() => {
                  setShowAllLayers(false);
                  setSelectedLayer(layerId);
                }}
              />
              Layer {layerId} only ({hierarchyAnalysis.layerCounts[layerId]} topics)
            </label>
          ))}
        </div>

        <div className="selection-info">
          <h3>Selection Summary</h3>
          <p>{selectedComments.size} comments selected</p>
          <button 
            onClick={() => setSelectedComments(new Set())}
            disabled={selectedComments.size === 0}
          >
            Clear selection
          </button>
        </div>
      </div>

      <div className="comments-content">
        {showAllLayers ? (
          hierarchyAnalysis?.layers.map(layerId => renderCommentsForLayer(layerId))
        ) : (
          renderCommentsForLayer(selectedLayer)
        )}
      </div>

      <style jsx>{`
        .topic-prioritize {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .header {
          border-bottom: 1px solid #ccc;
          margin-bottom: 30px;
          padding-bottom: 15px;
        }

        .header h1 {
          margin: 0 0 5px 0;
          color: #03a9f4;
        }

        .subtitle {
          color: #666;
          margin-bottom: 10px;
        }

        .report-info {
          font-size: 0.9em;
          color: #888;
        }

        .hierarchy-analysis {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 30px;
          border: 1px solid #e9ecef;
        }

        .analysis-result.hierarchical {
          border-left: 4px solid #28a745;
        }

        .analysis-result.flat {
          border-left: 4px solid #ffc107;
        }

        .circle-pack-suggestion {
          background: #e7f3ff;
          padding: 15px;
          border-radius: 6px;
          margin: 15px 0;
          border: 1px solid #b8daff;
        }

        .circle-pack-suggestion h5 {
          margin-top: 0;
          color: #0056b3;
        }

        .circle-pack-suggestion ul {
          margin: 10px 0;
          padding-left: 20px;
        }

        .layer-summary {
          margin-top: 20px;
        }

        .layer-info {
          margin-bottom: 10px;
          padding: 10px;
          background: white;
          border-radius: 4px;
          border: 1px solid #dee2e6;
        }

        .sample-topics {
          margin-top: 5px;
          font-size: 0.85em;
        }

        .topic-sample {
          display: inline-block;
          background: #e9ecef;
          padding: 2px 6px;
          border-radius: 3px;
          margin-right: 5px;
          margin-top: 3px;
        }

        .controls {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 30px;
          margin-bottom: 30px;
          padding: 20px;
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
        }

        .layer-controls label {
          display: block;
          margin-bottom: 8px;
          cursor: pointer;
        }

        .layer-controls input[type="radio"] {
          margin-right: 8px;
        }

        .selection-info {
          text-align: right;
        }

        .selection-info button {
          background: #dc3545;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-top: 10px;
        }

        .selection-info button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .layer-section {
          margin-bottom: 40px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          background: white;
        }

        .layer-section h3 {
          margin: 0;
          padding: 15px 20px;
          background: #f8f9fa;
          border-bottom: 1px solid #e0e0e0;
          border-radius: 8px 8px 0 0;
          color: #495057;
        }

        .topic-section {
          margin: 20px;
          border-left: 3px solid #03a9f4;
          padding-left: 15px;
        }

        .topic-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .topic-header h4 {
          margin: 0;
          color: #03a9f4;
        }

        .topic-controls {
          display: flex;
          align-items: center;
          gap: 15px;
          font-size: 0.9em;
        }

        .topic-controls label {
          cursor: pointer;
        }

        .topic-info {
          color: #666;
        }

        .topic-comments {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 4px;
          border: 1px solid #e9ecef;
        }

        .coming-soon {
          color: #666;
          font-style: italic;
          margin: 0;
        }

        .coming-soon small {
          display: block;
          margin-top: 10px;
          color: #888;
          font-size: 0.8em;
        }

        .loading, .error-message {
          text-align: center;
          padding: 40px;
        }

        .error-message {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
};

export default TopicPrioritize;