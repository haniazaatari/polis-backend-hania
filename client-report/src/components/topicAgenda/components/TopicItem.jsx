import React from "react";
import { getCommentCount, cleanTopicDisplayName } from "../utils/topicUtils";

const TopicItem = ({ 
  entry, 
  layerId, 
  isSelected, 
  onToggleSelection, 
  clusterGroups,
  isBanked = false 
}) => {
  const { clusterId, topic, proximityScore, closestBankedTopic } = entry;
  const topicKey = topic.topic_key;
  const commentCount = getCommentCount(layerId, clusterId, clusterGroups);
  const displayName = cleanTopicDisplayName(topic.topic_name, layerId, clusterId);

  return (
    <div 
      className={`topic-item ${
        isBanked ? 'banked-brick' : 
        isSelected ? 'selected brick' : 'unselected'
      }`}
      onClick={isBanked ? undefined : () => onToggleSelection(topicKey)}
    >
      <div className="topic-content">
        <span className="topic-id-hidden">
          {layerId}_{clusterId} ({commentCount} comments)
        </span>
        {proximityScore !== null && closestBankedTopic && (
          <span className="proximity-info-hidden">
            {' '}(d: {proximityScore.toFixed(3)} from {closestBankedTopic.replace('_', '_')})
          </span>
        )}
        <span className="topic-text">{displayName}</span>
        {proximityScore !== null && (
          <span className="distance-display" style={{fontSize: '0.8rem', color: '#666', marginLeft: '8px'}}>
            d: {proximityScore.toFixed(2)}
          </span>
        )}
        <input
          type="checkbox"
          checked={isSelected || isBanked}
          disabled={isBanked}
          onChange={() => {}} // onClick on parent handles it
          className="topic-checkbox"
        />
      </div>
    </div>
  );
};

export default TopicItem;
