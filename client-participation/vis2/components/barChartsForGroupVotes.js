import React from "react";
import _ from "lodash";
import * as globals from "./globals";
import closestPoint from "../util/closestPointOnPath";

const BarChartsForGroupVotes = ({
  selectedComment,
  groups,
  hullElems
}) => {


  const position_nw_0 = 0;
  const position_nw_1 = -globals.side;

  const position_sw_0 = globals.side;
  const position_sw_1 = 0;

  const position_ne_0 = 0;
  const position_ne_1 = globals.side;

  const position_se_0 = globals.side;
  const position_se_1 = globals.side;

  const corners = [
    [position_nw_0, position_nw_1],
    [position_sw_0, position_sw_1],
    [position_ne_0, position_ne_1],
    [position_se_0, position_se_1],
  ];


  function getLabelAnchorForHull(hull) {
    const candidates = corners.map((c) => {
      const pt = closestPoint(hull, c);
      const dx = c[0] - pt[0];
      const dy = c[1] - pt[1];
      return {
        pt: pt,
        dist: Math.sqrt(dx * dx + dy * dy),
      };
    });
    let pt = _.maxBy(candidates, (c) => {
      return -c.dist;
    }).pt;

    if (pt[0] < globals.side / 2) {
      pt[0] -= 90;
    } else {
      pt[0] -= 10;
    }
    if (pt[1] < globals.side / 4) {
      pt[1] += 10;
    } else {
      pt[1] -= 10;
    }
    return pt;
  }



  const drawBarChartsForGroupVotesOnSelectedComment = () => {
    let arr = []
    _.each(groups, (group) => {

      const closestPair = getLabelAnchorForHull(hullElems[group.id]);

      arr.push(
        <g key={group.id}>
          <BarChartCompact
            key={group.id}
            selectedComment={selectedComment}
            groupVotes={group /* hardcode first group for debug */}
            translate={closestPair}
            ptptCount={"ptptCount doesn't matter and isn't used because this barchart is for a group, not global"} />
        </g>
      )
    })
    return arr;
  }

  return (
    <g>
      {selectedComment ? drawBarChartsForGroupVotesOnSelectedComment() : null}
    </g>
  )

}

export default BarChartsForGroupVotes;
