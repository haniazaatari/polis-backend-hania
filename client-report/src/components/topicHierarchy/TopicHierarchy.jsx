import React, { useState, useEffect, useRef } from "react";
import { useReportId } from "../framework/useReportId";
import * as d3 from "d3";

const TopicHierarchy = ({ conversation }) => {
  const { report_id } = useReportId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hierarchyData, setHierarchyData] = useState(null);
  const circlePackRef = useRef(null);

  useEffect(() => {
    if (!report_id) return;
    fetchHierarchyData();
  }, [report_id]);

  // Fetch hierarchical cluster structure from DynamoDB
  const fetchHierarchyData = async () => {
    try {
      // Use the zinvite from conversation data instead of report_id
      const conversationId = conversation?.conversation_id || report_id;
      const response = await fetch(`/api/v3/topicMod/hierarchy?conversation_id=${conversationId}`);
      const data = await response.json();
      
      if (data.status === "success" && data.hierarchy) {
        setHierarchyData(data);
        console.log("Hierarchy data loaded:", data);
      } else {
        console.log("No hierarchy data available:", data.message);
        setError(data.message || "No hierarchy data available");
      }
      setLoading(false);
    } catch (err) {
      console.error("Error fetching hierarchy data:", err);
      setError("Failed to load hierarchy data");
      setLoading(false);
    }
  };

  // Create D3.js circle pack visualization following https://d3js.org/d3-hierarchy/pack
  const createCirclePack = () => {
    if (!hierarchyData || !circlePackRef.current) return;

    // Clear previous visualization
    d3.select(circlePackRef.current).selectAll("*").remove();

    const width = 1200;
    const height = 800;

    // Create SVG
    const svg = d3.select(circlePackRef.current)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("style", "width: 100%; height: auto; font: 10px sans-serif;");

    // Create hierarchy from data
    const root = d3.hierarchy(hierarchyData.hierarchy)
      .sum(d => d.size || 1)  // Use cluster size for circle size
      .sort((a, b) => b.value - a.value);

    // Create pack layout
    const pack = d3.pack()
      .size([width, height])
      .padding(3);

    // Apply the pack layout
    pack(root);

    // Color scale by layer (matching the existing theme)
    const colorScale = d3.scaleOrdinal()
      .domain([0, 1, 2, 3])
      .range(["#e8f4fd", "#b8daff", "#6bb6ff", "#1e7dff"]);

    // Create nodes
    const nodes = svg.selectAll("circle")
      .data(root.descendants())
      .enter()
      .append("g");

    // Add circles
    nodes.append("circle")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r", d => d.r)
      .attr("fill", d => {
        if (d.depth === 0) return "none"; // Root
        return colorScale(d.data.layer);
      })
      .attr("stroke", d => d.depth === 0 ? "#999" : "#fff")
      .attr("stroke-width", d => d.depth === 0 ? 2 : 1)
      .attr("fill-opacity", d => d.depth === 0 ? 0 : 0.7)
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        if (d.depth > 0) {
          d3.select(this).attr("fill-opacity", 0.9);
        }
      })
      .on("mouseout", function(event, d) {
        if (d.depth > 0) {
          d3.select(this).attr("fill-opacity", 0.7);
        }
      })
      .on("click", function(event, d) {
        if (d.data.layer !== undefined) {
          console.log("Clicked cluster:", d.data);
        }
      });

    // Add text labels for larger circles
    nodes.append("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", d => Math.min(d.r / 3, 12))
      .attr("fill", d => d.depth === 0 ? "#333" : "#000")
      .attr("font-weight", d => d.depth === 0 ? "bold" : "normal")
      .style("pointer-events", "none")
      .text(d => {
        if (d.depth === 0) return "Topic Hierarchy";
        if (d.r < 20) return ""; // Hide text for very small circles
        return `L${d.data.layer}C${d.data.clusterId}`;
      });

    // Add size labels for larger circles
    nodes.append("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y + 12)
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", d => Math.min(d.r / 5, 10))
      .attr("fill", "#666")
      .style("pointer-events", "none")
      .text(d => {
        if (d.depth === 0 || d.r < 25) return "";
        return `${d.data.size || d.value}`;
      });

    // Add legend
    const legend = svg.append("g")
      .attr("transform", `translate(20, 20)`);

    legend.append("text")
      .attr("font-weight", "bold")
      .attr("font-size", "16")
      .attr("fill", "#333")
      .text("Topic Layers");

    const legendItems = legend.selectAll(".legend-item")
      .data([
        { layer: 0, label: "Layer 0 (Finest)", color: "#e8f4fd" },
        { layer: 1, label: "Layer 1", color: "#b8daff" },
        { layer: 2, label: "Layer 2", color: "#6bb6ff" },
        { layer: 3, label: "Layer 3 (Coarsest)", color: "#1e7dff" }
      ])
      .enter()
      .append("g")
      .attr("class", "legend-item")
      .attr("transform", (d, i) => `translate(0, ${25 + i * 25})`);

    legendItems.append("circle")
      .attr("r", 10)
      .attr("fill", d => d.color)
      .attr("fill-opacity", 0.7)
      .attr("stroke", "#fff");

    legendItems.append("text")
      .attr("x", 20)
      .attr("dy", "0.3em")
      .attr("font-size", "14")
      .attr("fill", "#333")
      .text(d => d.label);

    // Add stats summary
    const stats = svg.append("g")
      .attr("transform", `translate(${width - 200}, 20)`);

    stats.append("text")
      .attr("font-weight", "bold")
      .attr("font-size", "16")
      .attr("fill", "#333")
      .text("Statistics");

    stats.append("text")
      .attr("y", 25)
      .attr("font-size", "14")
      .attr("fill", "#666")
      .text(`Total clusters: ${hierarchyData.totalClusters}`);

    stats.append("text")
      .attr("y", 45)
      .attr("font-size", "14")
      .attr("fill", "#666")
      .text(`Layers: ${hierarchyData.layers.length}`);
  };

  // Effect to create circle pack when hierarchy data is available
  useEffect(() => {
    if (hierarchyData) {
      createCirclePack();
    }
  }, [hierarchyData]);

  if (loading) {
    return (
      <div className="topic-hierarchy">
        <h1>Topic Hierarchy</h1>
        <div className="loading">Loading hierarchical topic data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="topic-hierarchy">
        <h1>Topic Hierarchy</h1>
        <div className="error-message">
          <h3>Error</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="topic-hierarchy">
      <div className="header">
        <h1>Topic Hierarchy</h1>
        <div className="subtitle">
          Interactive circle pack visualization of hierarchical topic clusters
        </div>
        <div className="report-info">Report ID: {report_id}</div>
      </div>

      <div className="visualization-container">
        <div ref={circlePackRef} className="circle-pack-visualization"></div>
      </div>

      <style jsx>{`
        .topic-hierarchy {
          padding: 20px;
          max-width: 100%;
          margin: 0 auto;
          background: #f8f9fa;
          min-height: 100vh;
        }

        .header {
          text-align: center;
          border-bottom: 1px solid #dee2e6;
          margin-bottom: 30px;
          padding-bottom: 20px;
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .header h1 {
          margin: 0 0 10px 0;
          color: #1e7dff;
          font-size: 2.5rem;
        }

        .subtitle {
          color: #666;
          margin-bottom: 10px;
          font-size: 1.1rem;
        }

        .report-info {
          font-size: 0.9em;
          color: #888;
        }

        .visualization-container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          padding: 20px;
          overflow: hidden;
        }

        .circle-pack-visualization {
          width: 100%;
          height: auto;
          min-height: 600px;
        }

        .loading, .error-message {
          text-align: center;
          padding: 60px 40px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .error-message {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .loading {
          font-size: 1.2rem;
          color: #666;
        }
      `}</style>
    </div>
  );
};

export default TopicHierarchy;