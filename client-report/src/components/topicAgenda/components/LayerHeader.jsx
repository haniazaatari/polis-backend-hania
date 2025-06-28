import React from "react";

const LayerHeader = ({ 
  hierarchyAnalysis, 
  completedLayers, 
  currentLayer, 
  currentSelections, 
  topicEntries,
  totalTopicsCount,
  onBankAndClear,
  onReset 
}) => {
  if (!hierarchyAnalysis) return null;

  const getLayerLabel = (layerId) => {
    const maxLayer = Math.max(...hierarchyAnalysis.layers);
    const minLayer = Math.min(...hierarchyAnalysis.layers);
    
    if (layerId === maxLayer) return 'Coarsest';
    if (layerId === minLayer) return 'Finest Grain';
    return 'Mid';
  };

  return (
    <div className="layer-header">
      <h1>Which topics are highest priority?</h1>
      
      <div className="call-to-action">
        Choose critical topics you want discussed more - topics you think are important overall, 
        topics you might think about a lot or even be an expert in! Help drive the overall agenda. 
        You can come back and change these any time, and the options will change as the conversation 
        grows - and as you submit comments yourself!
      </div>
      
      <div className="button-group">
        <div className="step-and-button">
          <h2>
            Step {completedLayers.size + 1} of {hierarchyAnalysis.layers.length}: {getLayerLabel(currentLayer)} Topics{' '}
            <span className="selection-count">
              ({currentSelections.size} selected of {topicEntries.length} close enough to show
              {currentLayer === Math.min(...hierarchyAnalysis.layers) ? 
                ` out of ${totalTopicsCount} total finest grain` : ''})
            </span>
          </h2>
          <div className="action-buttons">
            <button className="reset-button" onClick={onReset}>
              Reset
            </button>
            <button 
              className={`bank-button ${currentSelections.size === 0 ? 'disabled' : ''}`} 
              onClick={onBankAndClear}
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
  );
};

export default LayerHeader;
