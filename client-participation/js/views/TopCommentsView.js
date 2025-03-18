// Copyright (C) 2012-present, The Authors. This program is free software: you can redistribute it and/or  modify it under the terms of the GNU Affero General Public License, version 3, as published by the Free Software Foundation. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

var Handlebones = require("handlebones");
var itemTemplate = require("../templates/topCommentsItem.handlebars");

var width = 60;

module.exports = Handlebones.CollectionView.extend({
  tagName: "ul",
  className: "top-comments-list",
  name: "topCommentsView",
  modelView: Handlebones.ModelView.extend({
    tagName: "li",
    className: "top-comments-item",
    template: itemTemplate,
    events: {
      "render": "afterRender",
    },
    context: function () {
      var ctx = Handlebones.ModelView.prototype.context.apply(this, arguments);
      ctx.width = width;
      ctx.percent = ctx.percentAgree;
      ctx.color = "rgb(46, 204, 113)"; // agree_green
      return ctx;
    },
    render: function () {
      Handlebones.ModelView.prototype.render.apply(this, arguments);
      var i = 0;
      var that = this;
      function draw() {
        var $c = that.$("canvas");
        var c = $c[0];
        if (!c && i < 100) {
          i += 1;
          setTimeout(draw, 100);
          return;
        }
        var drawCtx = c.getContext("2d");
        drawCtx.beginPath();

        var fullArc = -Math.PI * 1.999999;

        var strokeWidth = 4;
        var radius = width / 2 - (strokeWidth + 1);

        var top = -Math.PI / 2;
        var endOfAgreeArc = fullArc * that.model.get("percentAgree") / 100 - Math.PI / 2;
        var endOfDisagreeArc = - fullArc * (that.model.get("percentDisagree") / 100) - Math.PI / 2;

        drawCtx.lineWidth = strokeWidth;
        drawCtx.strokeStyle = "rgb(46, 204, 113)"; // agree_green
        drawCtx.arc(width / 2, width / 2, radius,
          top, // arc starts at top
          endOfAgreeArc, // end angle of arc
          true // counterclockwise?
        );
        drawCtx.stroke();


        // draw disagree part
        drawCtx.strokeStyle = "rgb(231, 76, 60)"; // disagree_red
        drawCtx.beginPath();

        drawCtx.arc(width / 2, width / 2, radius,
          top, // arc starts at top
          endOfDisagreeArc, // end angle of arc
          false // counterclockwise?
        );
        drawCtx.stroke();

        // draw pass part
        drawCtx.strokeStyle = "rgb(200, 200, 200)"; // pass_gray
        drawCtx.beginPath();
        drawCtx.arc(width / 2, width / 2, radius,
          endOfAgreeArc,
          endOfDisagreeArc,
          true // counterclockwise?
        );
        drawCtx.stroke();

      }
      setTimeout(draw, 100);
    },
  }),

  initialize: function () {
    Handlebones.CollectionView.prototype.initialize.apply(this, arguments);
  }
});
