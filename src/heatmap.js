import angular from 'angular';
import $ from 'jquery';
import moment from 'moment';
import _ from 'lodash';
import kbn from 'app/core/utils/kbn';
import './bower_components/d3/d3.min.js';
import './bower_components/epoch/dist/js/epoch.js';

angular.module('grafana.directives').directive('grafanaHeatmapEpoch', function($rootScope, timeSrv) {
  return {
    restrict: 'A',
    template: '<div> </div>',
    link: function(scope, elem) {
      var ctrl = scope.ctrl;
      var dashboard = ctrl.dashboard;
      var panel = ctrl.panel;
      var data;
      var sortedSeries;
      var legendSideLastValue = null;
      var rootScope = scope.$root;
      var epoch = null;

      // Receive render events
      ctrl.events.on('render', function(renderData) {
        data = renderData || data;
        if (!data) {
          ctrl.refresh();
          return;
        }
        render_panel();
      });

      function getLegendHeight(panelHeight) {
        if (!panel.legend.show || panel.legend.rightSide) {
          return 2;
        }

        if (panel.legend.alignAsTable) {
          var legendSeries = _.filter(data, function(series) {
            return series.hideFromLegend(panel.legend) === false;
          });
          var total = 23 + (22 * legendSeries.length);
          return Math.min(total, Math.floor(panelHeight/2));
        } else {
          return 26;
        }
      }

      function setElementHeight() {
        try {
          var height = ctrl.height - getLegendHeight(ctrl.height);
          elem.css('height', height + 'px');

          return true;
        } catch(e) { // IE throws errors sometimes
          console.log(e);
          return false;
        }
      }

      function shouldAbortRender() {
        if (!data) {
          return true;
        }

        if (!setElementHeight()) { return true; }

        if (elem.width() === 0) {
          return true;
        }
      }

      function processOffsetHook(plot, gridMargin) {
        var left = panel.yaxes[0];
        var right = panel.yaxes[1];
        if (left.show && left.label) { gridMargin.left = 20; }
        if (right.show && right.label) { gridMargin.right = 20; }
      }

      // Function for rendering panel
      function render_panel() {
        if (shouldAbortRender()) {
          return;
        }

        var startTime = Math.floor(ctrl.range.from.valueOf() / 1000);
        var ticksTime = panel.ticksTime || 15;

        var delta = true;
        var seriesData = _.map(data, function (series, i) {
          delta = delta && series.color; // use color as delta temporaly, if all series is delta, enable realtime chart

          // if hidden remove points
          if (ctrl.hiddenSeries[series.alias]) {
            return [];
          }

          var result = [];
          var minIndex = Number.MAX_VALUE;
          _.chain(series.datapoints)
          .reject(function(dp) {
            return dp[0] === null;
          })
          .groupBy(function(dp) {
            return Math.floor(dp[1] / ticksTime / 1000); // group by time
          })
          .map(function(values, timeGroupKey) {
            return [
              // time
              Math.floor(timeGroupKey * ticksTime),
              // count
              _.chain(values)
              .map(function (value) {
                return value[0]; // pick value
              })
              .countBy(function(value) {
                return value;
              }).value()
            ];
          })
          .each(function(v) {
            var index = v[0] - startTime;
            if (index < minIndex) {
              minIndex = index;
            }
            result[index] = v[1];
          });

          return result;
        });
        var labels = _.map(data, function (series) {
          return series.label;
        });

        if (epoch && delta) {
          //epoch.push(sortedSeries);
          ctrl.renderingCompleted();
        } else {
          var heatmapOptions = {
            type: 'time.heatmap',
            axes: ['left', 'bottom'],
            opacity: function(value, max) {
              return Math.pow((value/max), 0.7);
            }
          };
          if (panel.windowSize) {
            heatmapOptions.windowSize = panel.windowSize;
          }
          if (panel.buckets) {
            heatmapOptions.buckets = panel.buckets;
          }
          if (panel.bucketRangeLower && panel.bucketRangeUpper) {
            heatmapOptions.bucketRange = [panel.bucketRangeLower, panel.bucketRangeUpper];
          }
          heatmapOptions.ticks = {};
          heatmapOptions.ticks.time = ticksTime;
          heatmapOptions.ticks.left = panel.ticksLeft || 5;
          heatmapOptions.ticks.Right = panel.ticksRight || 5;

          heatmapOptions.startTime = startTime;

          var model = new Epoch.Model({ dataFormat: 'array' });
          model.setData(seriesData);
          heatmapOptions.model = model;
          heatmapOptions.labels = labels;

          function callPlot(incrementRenderCounter) {
            try {
              epoch = elem.epoch(heatmapOptions);
            } catch (e) {
              console.log('epoch error', e);
            }

            if (incrementRenderCounter) {
              ctrl.renderingCompleted();
            }
          }

          if (shouldDelayDraw(panel)) {
            // temp fix for legends on the side, need to render twice to get dimensions right
            callPlot(false);
            setTimeout(function() { callPlot(true); }, 50);
            legendSideLastValue = panel.legend.rightSide;
          } else {
            callPlot(true);
          }
        }
      }

      function shouldDelayDraw(panel) {
        if (panel.legend.rightSide) {
          return true;
        }
        if (legendSideLastValue !== null && panel.legend.rightSide !== legendSideLastValue) {
          return true;
        }
      }

      elem.bind("plotselected", function (event, ranges) {
        scope.$apply(function() {
          timeSrv.setTime({
            from  : moment.utc(ranges.xaxis.from),
            to    : moment.utc(ranges.xaxis.to),
          });
        });
      });
    }
  };
});
