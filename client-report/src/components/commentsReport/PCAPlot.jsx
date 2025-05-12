import React, { useState, useEffect } from 'react';
import net from '../../util/net';

// ASCII-style characters for different groups
const GROUP_SYMBOLS = ['+', 'o', 'x', '*', '#', '■', '▲', '●'];

const PCAPlot = ({ report_id, isDarkMode }) => {
  const [pcaData, setPcaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!report_id) return;
    
    setLoading(true);
    
    // Fetch PCA data from Delphi endpoint
    net.polisGet("/api/v3/delphi/visualizations", {
      report_id: report_id
    })
      .then(response => {
        if (response?.status === "success" && response.jobs && response.jobs.length > 0) {
          // Find the most recent completed job
          const completedJobs = response.jobs.filter(job => job.status === "COMPLETED");
          if (completedJobs.length > 0) {
            console.log("Found completed job, checking for PCA data");
            
            // Check for any available PCAs
            const latestJobId = completedJobs[0].job_id;
            
            // Now fetch the actual PCA data
            return net.polisGet("/api/v3/delphi", {
              report_id: report_id,
              job_id: latestJobId,
              data_type: "pca"
            });
          }
        }
        
        // If no completed jobs, return null
        return { status: 'error', message: 'No completed jobs found' };
      })
      .then(pcaResponse => {
        if (pcaResponse?.status === "success" && pcaResponse.pca_data) {
          // Process the PCA data into the format we need
          const processedData = processPCAData(pcaResponse.pca_data);
          setPcaData(processedData);
        } else {
          // If we can't get real data, create mock data for development
          console.log("Generating mock PCA data for development");
          const mockPCAData = generateMockPCAData();
          setPcaData(mockPCAData);
        }
        
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching PCA data:", err);
        setError("Failed to fetch PCA data");
        setLoading(false);
        
        // Generate mock data even on error for development
        const mockPCAData = generateMockPCAData();
        setPcaData(mockPCAData);
      });
  }, [report_id]);
  
  // Process actual PCA data from the server
  const processPCAData = (rawData) => {
    try {
      // Expected format depends on what the server returns
      // This is a placeholder - adjust based on actual API response
      return {
        points: rawData.points || [],
        groups: rawData.groups || {},
        groupColors: rawData.groupColors || 
          ['#FF5555', '#55AAFF', '#AAFF55', '#FFAA55', '#AA55FF', '#FF55AA']
      };
    } catch (e) {
      console.error("Error processing PCA data:", e);
      return generateMockPCAData();
    }
  };
  
  // Generate mock PCA data for development/testing
  const generateMockPCAData = () => {
    // Create 3 distinct clusters
    const numGroups = 3;
    const pointsPerGroup = 15;
    const points = [];
    
    // Group 0: Top right cluster
    for (let i = 0; i < pointsPerGroup; i++) {
      points.push({
        x: 5 + Math.random() * 3,
        y: 5 + Math.random() * 3,
        group: 0
      });
    }
    
    // Group 1: Bottom left cluster
    for (let i = 0; i < pointsPerGroup; i++) {
      points.push({
        x: -5 - Math.random() * 3,
        y: -5 - Math.random() * 3,
        group: 1
      });
    }
    
    // Group 2: Top left cluster
    for (let i = 0; i < pointsPerGroup; i++) {
      points.push({
        x: -5 - Math.random() * 3,
        y: 5 + Math.random() * 3,
        group: 2
      });
    }
    
    // Add some scattered points
    for (let i = 0; i < 5; i++) {
      points.push({
        x: (Math.random() * 2 - 1) * 10,
        y: (Math.random() * 2 - 1) * 10,
        group: Math.floor(Math.random() * numGroups)
      });
    }
    
    return {
      points,
      groupColors: ['#FF5555', '#55AAFF', '#AAFF55']
    };
  };
  
  // Render the plot
  if (loading) {
    return (
      <div className="pca-loading">LOADING PCA...</div>
    );
  }
  
  if (error) {
    return (
      <div className="pca-error">ERROR: {error}</div>
    );
  }
  
  if (!pcaData || !pcaData.points || pcaData.points.length === 0) {
    return (
      <div className="pca-empty">NO PCA DATA AVAILABLE</div>
    );
  }
  
  // Render ASCII PCA plot
  const width = 280;
  const height = 220;
  const padding = 20;
  
  // Find min and max values to scale the plot
  const xValues = pcaData.points.map(p => p.x);
  const yValues = pcaData.points.map(p => p.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  
  // Scale function to map data points to SVG coordinates
  const scaleX = (x) => padding + ((x - xMin) / (xMax - xMin)) * (width - 2 * padding);
  const scaleY = (y) => height - padding - ((y - yMin) / (yMax - yMin)) * (height - 2 * padding);
  
  return (
    <div className="pca-plot-container">
      <div className="pca-plot-header">
        <span className="pca-title">PCA:PARTICIPANT-CLUSTERS</span>
      </div>
      
      <svg width={width} height={height} className="pca-plot">
        {/* Draw axes */}
        <line 
          x1={padding} y1={height - padding} 
          x2={width - padding} y2={height - padding} 
          className="axis-line" 
        />
        <line 
          x1={padding} y1={padding} 
          x2={padding} y2={height - padding} 
          className="axis-line" 
        />
        
        {/* Draw origin lines */}
        <line 
          x1={scaleX(0)} y1={padding} 
          x2={scaleX(0)} y2={height - padding} 
          className="origin-line" 
        />
        <line 
          x1={padding} y1={scaleY(0)} 
          x2={width - padding} y2={scaleY(0)} 
          className="origin-line" 
        />
        
        {/* Draw data points with ASCII-style symbols */}
        {pcaData.points.map((point, i) => {
          const groupIndex = point.group < GROUP_SYMBOLS.length ? point.group : point.group % GROUP_SYMBOLS.length;
          const symbol = GROUP_SYMBOLS[groupIndex];
          
          return (
            <text 
              key={i}
              x={scaleX(point.x)}
              y={scaleY(point.y)}
              fill={pcaData.groupColors[point.group % pcaData.groupColors.length] || '#FFFFFF'}
              textAnchor="middle"
              dominantBaseline="middle"
              className="data-point"
              fontSize="10"
            >
              {symbol}
            </text>
          );
        })}
        
        {/* Group legend */}
        <g className="legend">
          {Array.from(new Set(pcaData.points.map(p => p.group))).map((group, i) => (
            <g key={`legend-${group}`} transform={`translate(${width - 60}, ${padding + i * 14})`}>
              <text 
                x="0" 
                y="0" 
                fontSize="10" 
                fill={pcaData.groupColors[group % pcaData.groupColors.length]}
                dominantBaseline="middle"
              >
                {GROUP_SYMBOLS[group % GROUP_SYMBOLS.length]}
              </text>
              <text 
                x="12" 
                y="0" 
                fontSize="8" 
                fill="currentColor" 
                dominantBaseline="middle"
              >
                GROUP {group+1}
              </text>
            </g>
          ))}
        </g>
        
        {/* Axis labels */}
        <text x={width/2} y={height-5} className="axis-label">PC1</text>
        <text x={5} y={height/2} className="axis-label" transform={`rotate(-90, 5, ${height/2})`}>PC2</text>
      </svg>
      
      <style jsx>{`
        /* PCA Plot Styles */
        .pca-plot-container {
          margin-top: 5px;
          border: 1px solid;
        }
        
        .light-mode .pca-plot-container {
          border-color: #999;
          background-color: #fff;
        }
        
        .dark-mode .pca-plot-container {
          border-color: #444;
          background-color: #222;
        }
        
        .pca-plot-header {
          padding: 2px 4px;
          font-size: 11px;
          border-bottom: 1px solid;
          text-align: center;
          font-weight: bold;
        }
        
        .light-mode .pca-plot-header {
          border-color: #999;
          background-color: #eee;
        }
        
        .dark-mode .pca-plot-header {
          border-color: #444;
          background-color: #333;
        }
        
        .pca-plot {
          padding: 2px;
          font-family: "Berkeley Mono", "Source Code Pro", monospace;
        }
        
        .axis-line {
          stroke: #777;
          stroke-width: 1;
        }
        
        .origin-line {
          stroke: #777;
          stroke-width: 0.5;
          stroke-dasharray: 3,3;
        }
        
        .axis-label {
          font-size: 10px;
          text-anchor: middle;
          fill: currentColor;
          font-family: "Berkeley Mono", "Source Code Pro", monospace;
        }
        
        .data-point {
          font-family: "Berkeley Mono", "Source Code Pro", monospace;
        }
        
        /* Loading and error states */
        .pca-loading, .pca-error, .pca-empty {
          display: flex;
          justify-content: center;
          align-items: center;
          border: 1px dashed;
          height: 100px;
          margin-top: 10px;
          font-size: 11px;
          font-family: "Berkeley Mono", "Source Code Pro", monospace;
        }
        
        .light-mode .pca-loading {
          border-color: #0288d1;
          color: #0288d1;
        }
        
        .dark-mode .pca-loading {
          border-color: #29b6f6;
          color: #29b6f6;
        }
        
        .light-mode .pca-error {
          border-color: #d32f2f;
          color: #d32f2f;
        }
        
        .dark-mode .pca-error {
          border-color: #ef5350;
          color: #ef5350;
        }
        
        .light-mode .pca-empty {
          border-color: #ff9800;
          color: #ff9800;
        }
        
        .dark-mode .pca-empty {
          border-color: #ffa726;
          color: #ffa726;
        }
      `}</style>
    </div>
  );
};

export default PCAPlot;