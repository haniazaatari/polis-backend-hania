import React from "react";
import _ from "lodash";
// import {ReactSVGPanZoom} from 'react-svg-pan-zoom';
import * as globals from "./globals";
import graphUtil from "../util/graphUtil";
import Axes from "./graphAxes";
import Hulls from "./hull";
import BarChartsForGroupVotes from "./barChartsForGroupVotes";
import ExploreTid from "./exploreTid";
import TidCarousel from "./tidCarousel";
import Participants from "./graphParticipants";
import Comments from "./graphComments";
import Curate from "./curate";
import HullLabels from "./hullLabels";

class Graph extends React.Component {

  constructor(props) {
    super(props);
    this.hullElems = [];
    this.Viewer = null;

    this.state = {
      selectedComment: null,
      selectedTidCuration: null,
      browserDimensions: window.innerWidth
    };
  }

  componentWillMount() {

    window.addEventListener("resize", () => {
      this.setState({ browserDimensions: window.innerWidth })
    })
  }

  componentWillReceiveProps(nextProps) {

    if (!nextProps.math) {
      return;
    }

    let tidsToShowSet = _.keyBy(nextProps.tidsToShow);

    let {
      xx,
      yy,
      commentsPoints,
      xCenter,
      yCenter,
      baseClustersScaled,
      commentScaleupFactorX,
      commentScaleupFactorY,
      hulls,
      groupCentroids,
      groupCornerAssignments,
      ptptoisProjected,
    } = graphUtil(nextProps.comments, nextProps.math, nextProps.badTids, nextProps.ptptois);

    commentsPoints = commentsPoints.filter((c) => {
      return !_.isUndefined(tidsToShowSet[c.tid]);
    });

    let tidCarouselComments = nextProps.comments.filter((c) => {
      return !_.isUndefined(tidsToShowSet[c.tid]);
    });

    let selectedComment = this.state.selectedComment

    if (this.state.selectedComment === null && this.state.selectedTidCuration !== null) {
      selectedComment = tidCarouselComments[0]
    }

    this.setState({
      xx,
      yy,
      commentsPoints,
      xCenter,
      yCenter,
      baseClustersScaled,
      commentScaleupFactorX,
      commentScaleupFactorY,
      hulls,
      groupCentroids,
      groupCornerAssignments,
      ptptoisProjected,
      selectedComment,
      tidCarouselComments
    })

  }

  handleCommentHover(selectedComment) {
    return () => {
      this.setState({
        selectedComment
      });
    }
  }

  handleCommentClick(selectedComment) {
    return () => {
      this.setState({
        selectedComment
      });
    }
  }

  handleReturnToVoteClicked() {
    this.setState({ selectedComment: null })
  }
  handleCurateButtonClick(tidCuration) {

    this.setState({
      selectedTidCuration: tidCuration,
      selectedComment: null
    }, () => {
      this.props.onCurationChange && this.props.onCurationChange(tidCuration);
    });
  }

  getHullElems(gid) {
    return (elem) => {
      if (elem !== null) {
        this.hullElems[gid] = elem;
      }
    }
  }

  render() {

    let ww = parseInt(getComputedStyle(document.getElementById('visualization_parent_div')).width, 10);
    let w = globals.sideWithPadding;
    let svgScale = 1;
    /*
      if the width of the body is less than the width of the svg...
      scale it down
      if the body is at 500 and the svg is 700, then it's a 5 to 7 ratio
      scaling factor on the svg
    */
    if (ww < w) {
      svgScale = ww / w;
    }
    let svgNegativeMargin = globals.svgHeightWithPadding * (svgScale - 1);

    return (
      <div>
        <svg width={globals.sideWithPadding} height={globals.svgHeightWithPadding} style={{
          transform: "scale(" + svgScale + ")",
          transformOrigin: "0% 0%",
          marginBottom: svgNegativeMargin
        }
        }>
          <filter id="grayscale">
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <g transform={`translate(${globals.padding}, ${globals.padding})`}>
            {/* Comment https://bl.ocks.org/mbostock/7555321 */}
            <g transform={`translate(${globals.side / 2}, ${15})`}>
              <text
                style={{
                  fontFamily: "Georgia",
                  fontSize: 14,
                  fontStyle: "italic"
                }}
                textAnchor="middle">

              </text>
            </g>
            <Axes
              xCenter={this.state.xCenter}
              yCenter={this.state.yCenter}
              report={this.props.report} />
            <Hulls
              handleClick={this.handleCurateButtonClick.bind(this)}
              selectedGroup={_.isNumber(this.state.selectedTidCuration) ? this.state.selectedTidCuration : null}
              getHullElems={this.getHullElems.bind(this)}
              hulls={this.state.hulls} />
            <Participants
              selectedGroup={_.isNumber(this.state.selectedTidCuration) ? this.state.selectedTidCuration : null}
              points={this.state.baseClustersScaled}
              ptptois={this.state.ptptoisProjected} />
            <HullLabels
              handleClick={this.handleCurateButtonClick.bind(this)}
              selectedGroup={_.isNumber(this.state.selectedTidCuration) ? this.state.selectedTidCuration : null}
              groups={this.props.math["group-votes"] || window.preload.firstMath["group-votes"] /* for labels */}
              centroids={this.state.groupCentroids}
            />
            <BarChartsForGroupVotes
              hullElems={this.hullElems}
              selectedComment={this.state.selectedComment}
              allComments={this.props.comments}
              groups={this.props.math["group-votes"] || window.preload.firstMath["group-votes"]}
              groupCornerAssignments={this.state.groupCornerAssignments}
            />
          </g>
        </svg>
        <div style={{
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          width: "100%",
          justifyContent: "center",
          margin: "20px 0px",
        }}>
          <Curate
            handleCurateButtonClick={this.handleCurateButtonClick.bind(this)}
            math={this.props.math}
            selectedTidCuration={this.state.selectedTidCuration}
            Strings={this.props.Strings}
          />
          <TidCarousel
            selectedTidCuration={this.state.selectedTidCuration}
            commentsToShow={this.state.tidCarouselComments}
            handleCommentClick={this.handleCommentClick.bind(this)}
            selectedComment={this.state.selectedComment}
            Strings={this.props.Strings}
          />
        </div>
        <ExploreTid
          browserDimensions={this.state.browserDimensions}
          handleReturnToVoteClicked={this.handleReturnToVoteClicked.bind(this)}
          selectedComment={this.state.selectedComment}
          votesByMe={this.props.votesByMe}
          selectedTidCuration={this.state.selectedTidCuration}
          math={this.props.math || window.preload.firstMath}
          onVoteClicked={this.props.onVoteClicked}
          Strings={this.props.Strings}
          comments={this.props.comment} />
      </div>
    );
  }
}

export default Graph;
