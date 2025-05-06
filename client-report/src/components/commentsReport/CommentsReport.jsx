import React, { useState, useEffect } from 'react';
import net from '../../util/net';
import { useReportId } from '../framework/useReportId';

const CommentsReport = () => {
  const { report_id } = useReportId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topics, setTopics] = useState({});
  const [runs, setRuns] = useState({});
  const [selectedRunKey, setSelectedRunKey] = useState(null);
  const [visualizationJobs, setVisualizationJobs] = useState([]);
  const [visualizationsLoading, setVisualizationsLoading] = useState(true);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [jobFormData, setJobFormData] = useState({
    job_type: 'FULL_PIPELINE',
    priority: 50,
    max_votes: '',
    batch_size: '',
    model: 'claude-3-7-sonnet-20250219',
    include_topics: true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobCreationResult, setJobCreationResult] = useState(null);

  useEffect(() => {
    if (!report_id) return;

    setLoading(true);
    // Fetch LLM topics from Delphi endpoint
    net.polisGet("/api/v3/delphi", {
      report_id: report_id
    })
      .then(response => {
        console.log("Delphi response:", response);
        
        if (response && response.status === "success") {
          if (response.runs && Object.keys(response.runs).length > 0) {
            // Set the runs data
            setRuns(response.runs);
            
            // Select the first (most recent) run by default
            const runKeys = Object.keys(response.runs);
            setSelectedRunKey(runKeys[0]);
          } else if (response.available_tables) {
            setError(`DynamoDB connected but the required table doesn't exist yet. This is normal until the Delphi pipeline has been run for this conversation.`);
          } else if (response.error) {
            setError(`Error: ${response.error}`);
          } else {
            setError("No LLM topic data available yet");
          }
        } else {
          setError("Failed to retrieve LLM topics");
        }
        
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching LLM topics:", err);
        setError("Failed to connect to the Delphi endpoint");
        setLoading(false);
      });
      
    // Fetch visualizations from the new endpoint
    setVisualizationsLoading(true);
    net.polisGet("/api/v3/delphi/visualizations", {
      report_id: report_id
    })
      .then(response => {
        console.log("Visualizations response:", response);
        
        if (response && response.status === "success" && response.jobs) {
          setVisualizationJobs(response.jobs);
        }
        
        setVisualizationsLoading(false);
      })
      .catch(err => {
        console.error("Error fetching visualizations:", err);
        setVisualizationsLoading(false);
      });
  }, [report_id]);

  // Handle job form input changes
  const handleJobFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setJobFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // Handle job form submission
  const handleJobFormSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setJobCreationResult(null);

    // Send request to create a new job
    net.polisPost('/api/v3/delphi/jobs', {
      report_id: report_id,
      ...jobFormData
    })
      .then(response => {
        console.log('Job creation response:', response);
        
        if (response && response.status === 'success') {
          setJobCreationResult({ 
            success: true, 
            message: `Job created successfully with ID: ${response.job_id}`,
            job_id: response.job_id
          });
        } else {
          throw new Error(response?.error || 'Unknown error creating job');
        }
        
        // Refresh visualizations list after a slight delay
        setTimeout(() => {
          // Fetch visualizations to get the new job
          net.polisGet("/api/v3/delphi/visualizations", {
            report_id: report_id
          })
            .then(response => {
              if (response && response.status === "success" && response.jobs) {
                setVisualizationJobs(response.jobs);
              }
            })
            .catch(err => {
              console.error("Error refreshing visualizations:", err);
            });
        }, 2000);
      })
      .catch(err => {
        console.error('Error creating job:', err);
        setJobCreationResult({ 
          success: false, 
          message: `Error creating job: ${err.message || 'Unknown error'}`
        });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  // Toggle job form visibility
  const toggleJobForm = () => {
    setJobFormOpen(!jobFormOpen);
    // Reset result message when closing the form
    if (jobFormOpen) {
      setJobCreationResult(null);
    }
  };

  // Get the current selected run data
  const selectedRun = selectedRunKey ? runs[selectedRunKey] : null;

  // Render topic cards for a layer
  const renderTopicCards = (layerId) => {
    if (!selectedRun || !selectedRun.topics_by_layer || !selectedRun.topics_by_layer[layerId]) {
      return <p>No topics found for this layer</p>;
    }

    const layerTopics = selectedRun.topics_by_layer[layerId];
    return (
      <div className="topics-grid">
        {Object.keys(layerTopics).map(clusterId => {
          const topic = layerTopics[clusterId];
          // Skip topics that are clearly errors (like "Here are the topic labels:")
          if (topic.topic_name.toLowerCase().includes("here are the topic") || 
              topic.topic_name.toLowerCase().includes("topic label")) {
            return null;
          }
          
          return (
            <div key={`${layerId}-${clusterId}`} className="topic-card">
              <h3>{topic.topic_name}</h3>
              <p>Group {clusterId}</p>
              <p className="topic-meta">Generated by {topic.model_name} on {topic.created_at.substring(0, 10)}</p>
            </div>
          );
        })}
      </div>
    );
  };

  // Render job creation form
  const renderJobCreationForm = () => {
    return (
      <div className="job-creation-form-container">
        <div className="form-header">
          <h3>Create New Delphi Job</h3>
          <button
            className="close-button"
            onClick={toggleJobForm}
            aria-label="Close form"
          >
            &times;
          </button>
        </div>
        
        {jobCreationResult && (
          <div className={`result-message ${jobCreationResult.success ? 'success' : 'error'}`}>
            {jobCreationResult.message}
          </div>
        )}
        
        <form onSubmit={handleJobFormSubmit}>
          <div className="form-group">
            <label htmlFor="job_type">Job Type:</label>
            <select 
              id="job_type" 
              name="job_type" 
              value={jobFormData.job_type}
              onChange={handleJobFormChange}
              disabled={isSubmitting}
            >
              <option value="FULL_PIPELINE">Full Pipeline (PCA + UMAP + Report)</option>
              <option value="PCA">PCA Only</option>
              <option value="UMAP">UMAP Only</option>
              <option value="REPORT">Report Only</option>
            </select>
          </div>
          
          <div className="form-group">
            <label htmlFor="priority">Priority (0-100):</label>
            <input 
              type="number" 
              id="priority" 
              name="priority" 
              min="0" 
              max="100" 
              value={jobFormData.priority}
              onChange={handleJobFormChange}
              disabled={isSubmitting}
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="max_votes">Max Votes (optional):</label>
              <input 
                type="number" 
                id="max_votes" 
                name="max_votes" 
                min="0"
                value={jobFormData.max_votes}
                onChange={handleJobFormChange}
                disabled={isSubmitting}
                placeholder="Leave empty for all votes"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="batch_size">Batch Size (optional):</label>
              <input 
                type="number" 
                id="batch_size" 
                name="batch_size" 
                min="1"
                value={jobFormData.batch_size}
                onChange={handleJobFormChange}
                disabled={isSubmitting}
                placeholder="Default batch size"
              />
            </div>
          </div>
          
          <div className="form-group">
            <label htmlFor="model">LLM Model:</label>
            <select 
              id="model" 
              name="model" 
              value={jobFormData.model}
              onChange={handleJobFormChange}
              disabled={isSubmitting}
            >
              <option value="claude-3-7-sonnet-20250219">Claude 3 Sonnet</option>
              <option value="claude-3-opus-20240229">Claude 3 Opus</option>
              <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
            </select>
          </div>
          
          <div className="form-group checkbox">
            <label htmlFor="include_topics">
              <input 
                type="checkbox" 
                id="include_topics" 
                name="include_topics" 
                checked={jobFormData.include_topics}
                onChange={handleJobFormChange}
                disabled={isSubmitting}
              />
              Generate topic names
            </label>
          </div>
          
          <div className="form-actions">
            <button 
              type="submit" 
              className="submit-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating Job...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    );
  };

  // Render visualization section
  const renderVisualizations = () => {
    if (visualizationsLoading) {
      return <div className="loading">Loading visualizations...</div>;
    }
    
    return (
      <>
        <div className="section-header-actions">
          <button 
            className="create-job-button"
            onClick={toggleJobForm}
          >
            {jobFormOpen ? 'Cancel' : 'Run New Delphi Analysis'}
          </button>
        </div>
        
        {jobFormOpen && renderJobCreationForm()}
        
        {!visualizationJobs || !Array.isArray(visualizationJobs) || visualizationJobs.length === 0 ? (
          <div className="info-message">
            <p>No visualizations available yet. Click "Run New Delphi Analysis" to create a new job.</p>
          </div>
        ) : (
          <div className="visualizations-container">
            {Array.isArray(visualizationJobs) && visualizationJobs.map((job, index) => (
              <div key={job.jobId} className="visualization-job">
                <div className="job-header">
                  <h3>Visualization Job {index + 1}</h3>
                  <div className="job-meta">
                    <span className={`job-status status-${job.status}`}>{job.status}</span>
                    <span className="job-date">Created: {new Date(job.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                
                {job.visualizations && Array.isArray(job.visualizations) && job.visualizations.length > 0 ? (
                  <div className="visualizations-grid">
                    {job.visualizations
                      .filter(vis => vis && vis.type === 'interactive')
                      .map(vis => (
                        <div key={vis.key} className="visualization-card">
                          <h4>Layer {vis.layerId} Interactive Visualization</h4>
                          <div className="iframe-container">
                            <iframe 
                              src={vis.url} 
                              title={`Layer ${vis.layerId} visualization`}
                              width="100%" 
                              height="500"
                              frameBorder="0"
                            ></iframe>
                          </div>
                        </div>
                    ))}
                    
                    {job.visualizations
                      .filter(vis => vis && (vis.type === 'static_png' || vis.type === 'presentation_png'))
                      .map(vis => (
                        <div key={vis.key} className="visualization-card">
                          <h4>Layer {vis.layerId} Static Visualization</h4>
                          <div className="img-container">
                            <img 
                              src={vis.url} 
                              alt={`Layer ${vis.layerId} visualization`}
                              width="100%" 
                            />
                          </div>
                        </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-visualizations-message">
                    <p>No visualizations available for this job yet.</p>
                    <p className="help-text">Visualizations may take a few minutes to generate. You can refresh the page to check for updates.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="comments-report">
      {/* Use a simple h1 instead of the Heading component */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #ccc",
        marginBottom: 20,
        paddingBottom: 10
      }}>
        <h1>Comments Report</h1>
        <div>Report ID: {report_id}</div>
      </div>

      {loading ? (
        <div className="loading">Loading LLM topics data...</div>
      ) : error ? (
        <div className="error-message">
          <h3>Not Available Yet</h3>
          <p>{error}</p>
          <p>
            The Delphi system needs to process this conversation with LLM topic generation 
            before this report will be available.
          </p>
        </div>
      ) : (
        <div className="report-content">
          <div className="section">
            <div className="run-info">
              <div className="run-header">
                <h2>Group Topics <span style={{ fontWeight: 'normal', fontSize: '0.8em' }}>generated by {selectedRun?.model_name}</span></h2>
                <p className="generated-date">Generated on {selectedRun?.created_date}</p>
              </div>
              
              <p className="info-text">
                These are LLM-generated topic names based on the comments in each group.
                The algorithm has analyzed the content of comments to extract the main themes.
              </p>
              
              {selectedRun?.topics_by_layer && Object.keys(selectedRun.topics_by_layer).map(layerId => (
                <div key={layerId} className="layer-section">
                  <h2>Group Themes</h2>
                  {renderTopicCards(layerId)}
                </div>
              ))}
            </div>
          </div>
          
          <div className="section">
            <h2>Topic Visualizations</h2>
            <p className="info-text">
              These visualizations show the spatial relationships between topics and comments.
              Similar comments are positioned closer together on the map.
            </p>
            {renderVisualizations()}
          </div>
        </div>
      )}

      <style jsx>{`
        .comments-report {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        
        .topics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-top: 20px;
        }
        
        .topic-card {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 16px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
          background: white;
        }
        
        .topic-card h3 {
          margin-top: 0;
          color: #03a9f4;
        }
        
        .topic-meta {
          font-size: 0.8rem;
          color: #666;
          margin-top: 12px;
        }
        
        .layer-section {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }
        
        .run-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 5px;
        }
        
        .generated-date {
          color: #666;
          font-size: 0.9rem;
        }
        
        .info-text {
          background: #f0f7ff;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 30px;
          line-height: 1.5;
          color: #444;
          border-left: 4px solid #03a9f4;
        }
        
        .error-message {
          background: #fef8e8;
          border: 1px solid #f2d9a0;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }
        
        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 200px;
          font-size: 18px;
          color: #666;
        }
        
        .section {
          margin-bottom: 40px;
        }
        
        .visualizations-container {
          margin-top: 20px;
        }
        
        .visualization-job {
          background: white;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 20px;
          margin-bottom: 30px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        .job-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .job-meta {
          display: flex;
          align-items: center;
          gap: 15px;
        }
        
        .job-status {
          font-size: 0.9rem;
          padding: 4px 8px;
          border-radius: 4px;
          font-weight: 500;
        }
        
        .status-completed {
          background: #e3f9e5;
          color: #1b873f;
        }
        
        .status-running {
          background: #eef3fc;
          color: #0969da;
        }
        
        .status-pending {
          background: #fff8c5;
          color: #9a6700;
        }
        
        .status-failed {
          background: #ffebe9;
          color: #cf222e;
        }
        
        .job-date {
          font-size: 0.9rem;
          color: #666;
        }
        
        .visualizations-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 25px;
        }
        
        .visualization-card {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 15px;
          background: #fafafa;
        }
        
        .visualization-card h4 {
          margin-top: 0;
          margin-bottom: 15px;
          color: #444;
        }
        
        .iframe-container {
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid #ddd;
          background: white;
        }
        
        .img-container {
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid #ddd;
          background: white;
        }
        
        .info-message, .no-visualizations-message {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          color: #666;
          font-style: italic;
        }
        
        .no-visualizations-message .help-text {
          font-size: 0.85rem;
          margin-top: 8px;
          color: #888;
        }
        
        .section-header-actions {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 20px;
        }
        
        .create-job-button {
          background-color: #03a9f4;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        
        .create-job-button:hover {
          background-color: #0288d1;
        }
        
        .job-creation-form-container {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 30px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.05);
        }
        
        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid #eee;
        }
        
        .form-header h3 {
          margin: 0;
          color: #333;
        }
        
        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          color: #888;
          cursor: pointer;
        }
        
        .form-group {
          margin-bottom: 15px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: 500;
          color: #444;
        }
        
        .form-group input,
        .form-group select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }
        
        .form-group.checkbox {
          display: flex;
          align-items: center;
        }
        
        .form-group.checkbox label {
          display: flex;
          align-items: center;
          cursor: pointer;
        }
        
        .form-group.checkbox input {
          width: auto;
          margin-right: 8px;
        }
        
        .form-actions {
          margin-top: 25px;
          display: flex;
          justify-content: flex-end;
        }
        
        .submit-button {
          background-color: #4caf50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        
        .submit-button:hover {
          background-color: #388e3c;
        }
        
        .submit-button:disabled {
          background-color: #a5d6a7;
          cursor: not-allowed;
        }
        
        .result-message {
          padding: 12px 16px;
          border-radius: 4px;
          margin-bottom: 20px;
          font-weight: 500;
        }
        
        .result-message.success {
          background-color: #e8f5e9;
          color: #2e7d32;
          border: 1px solid #a5d6a7;
        }
        
        .result-message.error {
          background-color: #ffebee;
          color: #c62828;
          border: 1px solid #ffcdd2;
        }
      `}</style>
    </div>
  );
};

export default CommentsReport;