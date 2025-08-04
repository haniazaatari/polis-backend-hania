import React, { useState, useEffect, useRef } from 'react';
import _ from 'lodash';
import CommentList from '../../lists/commentList.jsx';

const VoronoiCells = ({ currentComment, voronoi, onHoverCallback, dataExtent }) => {
  const getFill = (cell) => {
    if (currentComment?.tid === cell.data.tid) {
      return "rgb(0,0,255)"; // Blue for selected
    } else {
      // Color based on group consensus value, normalized to data extent
      const consensus = cell.data.groupConsensus || 0;
      const [min, max] = dataExtent || [0, 1];
      const normalized = Math.max(0, Math.min(1, (consensus - min) / (max - min)));
      
      // Use a smooth gradient from red to yellow to green
      let r, g, b;
      
      if (normalized < 0.5) {
        // Red to Yellow (increase green)
        const ratio = normalized * 2;
        r = 231;
        g = Math.round(76 + (165 * ratio));
        b = 60;
      } else {
        // Yellow to Green (decrease red)
        const ratio = (normalized - 0.5) * 2;
        r = Math.round(231 * (1 - ratio));
        g = 231;
        b = 60;
      }
      
      return `rgb(${r},${g},${b})`;
    }
  }

  return (
    <g>
      {voronoi.map((cell, i) => {
        return (
          <g key={i} onMouseEnter={onHoverCallback(cell)}>
            <path fill="none" style={{pointerEvents: "all"}} d={"M" + cell.join("L") + "Z"}/>
            <circle
              r={4}
              fill={getFill(cell)}
              cx={cell.data.x}
              cy={cell.data.y}
            />
          </g>
        )
      })}
    </g>
  )
}

const TopicBeeswarm = ({ comments, commentTids, math, conversation, ptptCount, formatTid, voteColors }) => {
  const svgWidth = 1100; // Increased to fill modal width
  const svgHeight = 200;
  const margin = {top: 10, right: 40, bottom: 30, left: 40};
  const widthMinusMargins = svgWidth - margin.left - margin.right;
  const heightMinusMargins = svgHeight - margin.top - margin.bottom;

  const [currentComment, setCurrentComment] = useState(null);
  const [commentsWithConsensus, setCommentsWithConsensus] = useState(null);
  const [voronoi, setVoronoi] = useState(null);
  const [dataExtent, setDataExtent] = useState([0, 1]);
  const svgRef = useRef(null);

  const onHoverCallback = (d) => {
    return () => {
      setCurrentComment(d.data);
    }
  }

  const setup = () => {
    if (!comments || !commentTids || !math || !math["group-aware-consensus"]) return;

    // Filter to only topic comments and add group consensus
    const commentsWithConsensusData = [];
    comments.forEach((comment) => {
      if (commentTids.includes(comment.tid)) {
        const totalVotes = (comment.agree_count || 0) + (comment.disagree_count || 0) + (comment.pass_count || 0);
        const groupConsensus = math["group-aware-consensus"][comment.tid];
        if (groupConsensus !== undefined) {
          commentsWithConsensusData.push({
            ...comment,
            groupConsensus: groupConsensus,
            totalVotes: totalVotes
          });
        }
      }
    });

    if (commentsWithConsensusData.length === 0) return;

    // Find actual data extent with some padding
    const consensusValues = commentsWithConsensusData.map(d => d.groupConsensus);
    const minConsensus = Math.min(...consensusValues);
    const maxConsensus = Math.max(...consensusValues);
    
    // Add 5% padding to show all points clearly
    const padding = (maxConsensus - minConsensus) * 0.05;
    const paddedMin = Math.max(0, minConsensus - padding);
    const paddedMax = Math.min(1, maxConsensus + padding);
    
    setDataExtent([paddedMin, paddedMax]);

    // Create x scale based on actual data range
    const x = window.d3.scaleLinear()
      .domain([paddedMin, paddedMax])
      .rangeRound([0, widthMinusMargins]);

    // Run force simulation
    const simulation = window.d3.forceSimulation(commentsWithConsensusData)
      .force("x", window.d3.forceX(function(d) {
        return x(d.groupConsensus);
      }).strength(1))
      .force("y", window.d3.forceY(heightMinusMargins / 2))
      .force("collide", window.d3.forceCollide(5))
      .stop();

    // Run simulation
    for (let i = 0; i < 120; ++i) simulation.tick();

    // Create voronoi for hover detection
    const voronoiGenerator = window.d3.voronoi()
      .extent([[-margin.left, -margin.top], [widthMinusMargins + margin.right, heightMinusMargins + margin.top]])
      .x(function(d) { return d.x; })
      .y(function(d) { return d.y; });
    
    const voronoiPolygons = voronoiGenerator.polygons(commentsWithConsensusData);

    setCommentsWithConsensus(commentsWithConsensusData);
    setVoronoi(voronoiPolygons);

    // Add x-axis
    if (svgRef.current) {
      const svg = window.d3.select(svgRef.current);
      svg.select(".x-axis").remove(); // Clear any existing axis
      
      svg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(${margin.left}, ${heightMinusMargins + margin.top})`)
        .call(window.d3.axisBottom(x).ticks(5).tickFormat(d => d.toFixed(1)));
    }
  }

  useEffect(() => {
    setup();
  }, [comments, commentTids, math]);

  if (!commentsWithConsensus || !voronoi) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
        <p>Loading visualization...</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg ref={svgRef} width={svgWidth} height={svgHeight} style={{ display: 'block', margin: '0 auto' }}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          <VoronoiCells
            currentComment={currentComment}
            voronoi={voronoi}
            onHoverCallback={onHoverCallback}
            dataExtent={dataExtent}
          />
        </g>
      </svg>
      
      <div style={{ margin: "10px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
          {(() => {
            const steps = 6;
            const labels = [];
            for (let i = 0; i < steps; i++) {
              const value = dataExtent[0] + (dataExtent[1] - dataExtent[0]) * (i / (steps - 1));
              labels.push(
                <span key={i} style={{ fontSize: "11px", color: "#666" }}>
                  {value.toFixed(2)}
                </span>
              );
            }
            return labels;
          })()}
        </div>
        <div style={{ 
          height: "20px", 
          background: "linear-gradient(to right, #e74c3c, #f1c40f, #21a53a)",
          borderRadius: "4px",
          marginBottom: "5px"
        }}></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#666", maxWidth: "30%" }}>
            All groups<br/>DISAGREE
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#666", maxWidth: "30%", textAlign: "center" }}>
            Groups are split<br/>(or low votes)
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#666", maxWidth: "30%", textAlign: "right" }}>
            All groups<br/>AGREE
          </p>
        </div>
      </div>

      {currentComment && (
        <div style={{
          marginTop: "20px",
          padding: "15px",
          backgroundColor: "#f5f5f5",
          borderRadius: "8px",
          minHeight: "140px"
        }}>
          <div style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Group Consensus: {currentComment.groupConsensus.toFixed(3)} | 
            Total Votes: {currentComment.totalVotes}
          </div>
          <CommentList
            conversation={conversation}
            ptptCount={ptptCount}
            math={math}
            formatTid={formatTid}
            tidsToRender={[currentComment.tid]}
            comments={comments}
            voteColors={voteColors}
          />
        </div>
      )}
    </div>
  );
}

export default TopicBeeswarm;