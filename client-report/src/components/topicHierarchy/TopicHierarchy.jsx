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
      
      // Get hierarchy structure
      const hierarchyResponse = await fetch(`/api/v3/topicMod/hierarchy?conversation_id=${conversationId}`);
      const hierarchyData = await hierarchyResponse.json();
      
      // Get topic names that work
      const topicsResponse = await fetch(`/api/v3/topicMod/topics?conversation_id=${conversationId}`);
      const topicsData = await topicsResponse.json();
      
      console.log("Hierarchy response:", hierarchyData);
      console.log("Topics response:", topicsData);
      
      if (hierarchyData.status === "success" && hierarchyData.hierarchy && topicsData.status === "success" && topicsData.topics_by_layer) {
        // Create topic name lookup map from topics_by_layer
        const topicNameMap = new Map();
        Object.entries(topicsData.topics_by_layer).forEach(([layer, topics]) => {
          topics.forEach(topic => {
            const key = `layer${layer}_${topic.cluster_id}`;
            console.log("Adding to map:", key, "=>", topic.topic_name);
            topicNameMap.set(key, topic.topic_name);
          });
        });
        console.log("Final topic name map size:", topicNameMap.size);
        
        // Add topic names to hierarchy
        const addTopicNames = (node) => {
          const key = `layer${node.layer}_${node.clusterId}`;
          if (topicNameMap.has(key)) {
            node.topic_name = topicNameMap.get(key);
          }
          if (node.children) {
            node.children.forEach(addTopicNames);
          }
        };
        
        addTopicNames(hierarchyData.hierarchy);
        
        setHierarchyData(hierarchyData);
        console.log("Hierarchy data with topic names loaded:", hierarchyData);
      } else {
        console.log("Failed to load hierarchy or topics data");
        setError("Failed to load hierarchy or topics data");
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

    // Build CONTAINMENT hierarchy by inverting EVōC merge relationships
    // EVōC stores: Multiple Layer 0 → merge into → Single Layer 1
    // We need: Single Layer 3 → contains → Multiple Layer 2
    
    const buildContainmentHierarchy = () => {
      // First, organize all clusters by layer
      const clustersByLayer = {};
      const allClusters = {};
      
      // Flatten all clusters from the hierarchy data
      const flattenClusters = (node) => {
        if (node.layer !== undefined) {
          const key = `L${node.layer}C${node.clusterId}`;
          allClusters[key] = node;
          
          if (!clustersByLayer[node.layer]) clustersByLayer[node.layer] = [];
          clustersByLayer[node.layer].push(node);
        }
        if (node.children) {
          node.children.forEach(flattenClusters);
        }
      };
      
      hierarchyData.hierarchy.children.forEach(flattenClusters);
      
      console.log("Clusters by layer:", Object.keys(clustersByLayer).map(l => `Layer ${l}: ${clustersByLayer[l].length}`));
      
      // DEBUG: Check sample cluster structure
      console.log("Sample Layer 0 cluster:", clustersByLayer[0]?.[0]);
      console.log("Sample Layer 1 cluster:", clustersByLayer[1]?.[0]);
      console.log("Sample Layer 2 cluster:", clustersByLayer[2]?.[0]);
      const layer3Sample = clustersByLayer[3]?.[0];
      console.log("Sample Layer 3 cluster with topic_name:", layer3Sample);
      console.log("Layer 3 sample topic_name field:", layer3Sample?.topic_name);
      
      // Build containment map: higher layers contain all lower layers that eventually merge into them
      const containmentMap = {};
      
      // Initialize containment map
      for (let layer = 1; layer <= 3; layer++) {
        containmentMap[layer] = {};
        if (clustersByLayer[layer]) {
          clustersByLayer[layer].forEach(cluster => {
            const key = `L${layer}C${cluster.clusterId}`;
            containmentMap[layer][key] = [];
          });
        }
      }
      
      // For each lower layer cluster, find all higher layer clusters it eventually merges into
      for (let sourceLayer = 0; sourceLayer <= 2; sourceLayer++) {
        for (let targetLayer = sourceLayer + 1; targetLayer <= 3; targetLayer++) {
          if (clustersByLayer[sourceLayer] && clustersByLayer[targetLayer]) {
            
            clustersByLayer[sourceLayer].forEach(sourceCluster => {
              // Trace this cluster's merge path to see if it reaches targetLayer
              const visited = new Set();
              const traceToLayer = (cluster, currentLayer, targetLayer) => {
                if (currentLayer === targetLayer) {
                  return [cluster];
                }
                if (currentLayer >= targetLayer || !cluster.children || visited.has(`${currentLayer}-${cluster.clusterId}`)) {
                  return [];
                }
                
                visited.add(`${currentLayer}-${cluster.clusterId}`);
                
                const results = [];
                cluster.children.forEach(child => {
                  if (child.layer === currentLayer + 1) {
                    const nextCluster = clustersByLayer[child.layer]?.find(c => c.clusterId === child.clusterId);
                    if (nextCluster) {
                      const pathResults = traceToLayer(nextCluster, child.layer, targetLayer);
                      results.push(...pathResults);
                    }
                  }
                });
                return results;
              };
              
              const targetClusters = traceToLayer(sourceCluster, sourceLayer, targetLayer);
              if (targetClusters.length > 0) {
                console.log(`Layer ${sourceLayer} cluster ${sourceCluster.clusterId} traces to layer ${targetLayer}:`, targetClusters.map(c => c.clusterId));
              }
              
              targetClusters.forEach(targetCluster => {
                const targetKey = `L${targetLayer}C${targetCluster.clusterId}`;
                if (containmentMap[targetLayer] && containmentMap[targetLayer][targetKey]) {
                  // Only add if not already present
                  if (!containmentMap[targetLayer][targetKey].some(c => c.clusterId === sourceCluster.clusterId && c.layer === sourceCluster.layer)) {
                    containmentMap[targetLayer][targetKey].push(sourceCluster);
                    console.log(`Added L${sourceLayer}C${sourceCluster.clusterId} to L${targetLayer}C${targetCluster.clusterId}`);
                  }
                }
              });
            });
          }
        }
      }
      
      console.log("Containment map built:", containmentMap);
      
      // DEBUG: Check containment map contents
      Object.keys(containmentMap).forEach(layer => {
        const layerMap = containmentMap[layer];
        const keysWithChildren = Object.keys(layerMap).filter(key => layerMap[key].length > 0);
        console.log(`Layer ${layer} containers with children: ${keysWithChildren.length}/${Object.keys(layerMap).length}`);
        if (keysWithChildren.length > 0) {
          console.log(`Sample Layer ${layer} container:`, keysWithChildren[0], "contains", layerMap[keysWithChildren[0]].length, "children");
        }
      });
      
      // Build hierarchy starting from highest layer (coarsest)
      const maxLayer = Math.max(...Object.keys(clustersByLayer).map(Number));
      
      const buildNode = (cluster) => {
        const nodeKey = `L${cluster.layer}C${cluster.clusterId}`;
        console.log("BUILDNODE CALLED FOR:", cluster.clusterId, "topic_name:", cluster.topic_name);
        const node = {
          name: cluster.topic_name ? `${cluster.layer}_${cluster.clusterId}: ${cluster.topic_name}` : `L${cluster.layer}C${cluster.clusterId}`,
          layer: cluster.layer,
          clusterId: cluster.clusterId,
          size: cluster.size || 1,
          topic_name: cluster.topic_name,
          children: []
        };
        
        // Find direct children from the immediate layer below
        const childLayer = cluster.layer - 1;
        if (childLayer >= 0 && containmentMap[cluster.layer] && containmentMap[cluster.layer][nodeKey]) {
          const allChildren = containmentMap[cluster.layer][nodeKey];
          // Get only children from the immediate layer below
          const directChildren = allChildren.filter(child => child.layer === childLayer);
          
          console.log(`Building node ${nodeKey}: found ${allChildren.length} total children, ${directChildren.length} direct children from layer ${childLayer}`);
          console.log(`Direct children for ${nodeKey}:`, directChildren.map(c => `L${c.layer}C${c.clusterId}`));
          
          if (directChildren.length > 0) {
            node.children = directChildren.map(buildNode);
            // Parent nodes don't get size (only leaves do)
            delete node.size;
            console.log(`Node ${nodeKey} built with ${node.children.length} children`);
          }
        } else {
          console.log(`No children found for ${nodeKey} (childLayer: ${childLayer})`);
        }
        
        return node;
      };
      
      // Start with highest layer clusters as roots
      const rootClusters = clustersByLayer[maxLayer] || [];
      
      return {
        name: "Topic Hierarchy",
        children: rootClusters.map(buildNode)
      };
    };

    const nestedData = buildContainmentHierarchy();
    console.log("Containment hierarchy structure:", nestedData);
    console.log("First child topic_name:", nestedData.children?.[0]?.topic_name);

    // Create hierarchy from nested data
    const root = d3.hierarchy(nestedData)
      .sum(d => d.size || 0)  // Sum up sizes from leaf nodes
      .sort((a, b) => b.value - a.value);

    // Create pack layout with better padding for nested circles
    const pack = d3.pack()
      .size([width - 40, height - 40])
      .padding(d => d.depth * 3 + 2);  // More padding for deeper levels

    // Apply the pack layout
    pack(root);

    // Color scale by depth/layer (lighter for parent nodes, darker for leaf nodes)
    const colorScale = d3.scaleOrdinal()
      .domain([0, 1, 2, 3, 4])
      .range(["none", "#f0f8ff", "#d6eaff", "#6bb6ff", "#1e7dff"]);

    // Create groups for each node
    const node = svg.selectAll("g")
      .data(root.descendants())
      .enter()
      .append("g")
      .attr("transform", d => `translate(${d.x + 20},${d.y + 20})`);

    // Add circles
    node.append("circle")
      .attr("r", d => d.r)
      .attr("fill", d => {
        if (d.depth === 0) return "none"; // Root is invisible
        if (d.children) {
          // Parent nodes: lighter colors, semi-transparent
          return colorScale(d.depth);
        } else {
          // Leaf nodes: solid colors based on layer
          return colorScale(4); // Darkest blue for leaves
        }
      })
      .attr("stroke", d => {
        if (d.depth === 0) return "#ccc";
        if (d.children) return "#999";
        return "#fff";
      })
      .attr("stroke-width", d => d.depth === 0 ? 2 : 1)
      .attr("fill-opacity", d => {
        if (d.depth === 0) return 0;
        if (d.children) return 0.3; // Parent nodes are translucent
        return 0.8; // Leaf nodes are more opaque
      })
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        if (d.depth > 0) {
          d3.select(this).attr("stroke-width", 3);
        }
      })
      .on("mouseout", function(event, d) {
        if (d.depth > 0) {
          d3.select(this).attr("stroke-width", d => d.depth === 0 ? 2 : 1);
        }
      })
      .on("click", function(event, d) {
        console.log("Clicked node:", d.data);
      });

    // Add text labels for larger circles
    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", d => {
        if (d.depth === 0) return 16;
        return Math.min(d.r / 4, 12);
      })
      .attr("fill", d => {
        if (d.depth === 0) return "#333";
        if (d.children) return "#666";
        return "#000";
      })
      .attr("font-weight", d => d.depth <= 1 ? "bold" : "normal")
      .style("pointer-events", "none")
      .text(d => {
        if (d.depth === 0) return "Topics";
        if (d.r < 15) return ""; // Hide text for very small circles
        if (d.children) {
          // Parent nodes: show layer info
          return `Layer ${d.data.layer}`;
        } else {
          // Leaf nodes: show topic name or cluster ID
          console.log("D3 text rendering for:", d.data.clusterId, "topic_name:", d.data.topic_name);
          return d.data.topic_name || `L${d.data.layer}C${d.data.clusterId}`;
        }
      });

    // Add size labels for larger circles
    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1.5em")
      .attr("font-size", d => Math.min(d.r / 6, 10))
      .attr("fill", "#666")
      .style("pointer-events", "none")
      .text(d => {
        if (d.depth === 0 || d.r < 20) return "";
        if (d.children) {
          return `${d.children.length} clusters`;
        } else {
          return `${d.data.size || d.value}`;
        }
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