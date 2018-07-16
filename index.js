const https = require("https")
const http = require("http")
const net = require('net')
const {hrtime} = process
const AWS = require("aws-sdk")
const cloudwatch = new AWS.CloudWatch()

const hrToMs = (timing) => Math.round(timing[0] * 1000 + timing[1] / 1000000)
const hrDiff = (start, end) => hrToMs(end) - hrToMs(start)
const timingsDiff = (timings, key1, key2) => timings[key1] && timings[key2] && hrDiff(timings[key1], timings[key2])

const processTimings = function(timings) {
    return {
        lookup: timingsDiff(timings, "start", "lookup"),
        connect: timingsDiff(timings, "lookup", "connect"), 
        secureConnect: timingsDiff(timings, "connect", "secureConnect"),
        readable: timingsDiff(timings, "secureConnect", "readable") || timingsDiff(timings, "connect", "readable"),
        close: timingsDiff(timings, "readable", "close"),
        total: timingsDiff(timings, "start", "close")
    }
}

const createRequest = function(url, callback) {
    const handler = url.startsWith("http://") ? http : https
    return handler.get(url, callback)
}

const ArrayChunk = function (arr, len) {

  var chunks = [], i = 0, n = arr.length;

  while (i < n) {
    chunks.push(arr.slice(i, i += len));
  }

  return chunks;
}

/**
 * Query HTTP(S) Endpoints and log timings and HTTP status with CloudWatch
 * 
 * @param {Object} event
 * @param {Object[]} event.targets - HTTP(S) Endpoints to be checked
 * @param {string} event.targets[].url - Endpoint URL
 * @param {string} [event.targets[].name] - Endpoint Name
 * @param {string[]} [event.logTimings=["readable", "total"]] - Determine which timings are logged.
 * @param {string} [event.namespace="Watchtower"] - CloudWatch namespace
 * @param {number} [event.timeout=2000] - Time in ms before requests are aborted.
 */
exports.handler = function(event, context, callback) {
    const targets = event.targets
    if (!targets) callback("No targets given")

    const requests = targets.map(target => new Promise((resolve, reject) => {
        const data = {
            name: target.name || target.url,
            timings: {
                start: hrtime()
            }
        }
        if(target.type === undefined || target.type === 'http/s') {
            const request = createRequest(target.url, response => {
                data.statusCode = response.statusCode
                response.once("readable", () => data.timings.readable = hrtime())
                response.once("end", () => data.timings.end = hrtime())
            })
            request.setTimeout(1)
            const timeout = setTimeout(() => request.abort(), event.timeout || 2000)
            request.on("socket", socket => {
                socket.on("lookup", () => data.timings.lookup = hrtime())
                socket.on("connect", () => data.timings.connect = hrtime())
                socket.on("secureConnect", () => data.timings.secureConnect = hrtime())
            })
            request.on("close", () => {
                data.timings.close = hrtime()
                data.durations = processTimings(data.timings)
                clearTimeout(timeout)
                resolve(data)
            })
            request.on("error", () => {
                data.timings.close = hrtime()
                data.durations = processTimings(data.timings)
                data.statusCode = typeof data.statusCode !== "undefined" ? data.statusCode : 0
                clearTimeout(timeout)
                resolve(data)
            })
        } else if (target.type === 'tcp') {
            
            if(target.url.startsWith('http://') || target.url.startsWith('https://')){
                reject("http url for non http check")
            }
            
            const socket = new net.Socket()

            socket.setTimeout(event.timeout || 2000);

            socket.on('connect',() => {
                data.timings.connect = hrtime()
            })
            socket.on('lookup',() => {
                data.timings.lookup = hrtime()
            })
            socket.on('data',() => {
                data.timings.readable = hrtime()
                socket.end();
            })
            socket.on('end',() => {
                data.timings.end = hrtime()
            })
            socket.on('error',() => {
                data.timings.close = hrtime()
                data.durations = processTimings(data.timings)
                data.statusCode = -1
                socket.destroy()
                resolve(data)
            });
            socket.on('timeout', () => {
                data.timings.close = hrtime()
                data.durations = processTimings(data.timings)
                data.statusCode = -1
                socket.destroy()
                resolve(data)
            });
            socket.on('close', () => {
                data.timings.close = hrtime()
                data.durations = processTimings(data.timings)
                data.statusCode = 0
                socket.destroy()
                resolve(data)
            })

            socket.connect(target.port, target.url, () => {
            });
            
            
        }
    }))
    
    return Promise.all(requests).then(results => {
        const timestamp = new Date()
        const includedTimings = event.logTimings || ["readable", "total"]
        const metricData = results.map(result => {
            const timingMetrics = includedTimings.map(timing => {
                return {
                    MetricName: `timing-${timing}`,
                    Dimensions: [{Name: result.name, Value: `Timing: ${timing}`}],
                    Value: result.durations[timing],
                    Unit: "Milliseconds",
                    Timestamp: timestamp
                }
            })
            return [{
                MetricName: `status`,
                Dimensions: [{Name: result.name, Value: "HTTP Status"}],
                Value: result.statusCode,
                Timestamp: timestamp
            }, ...timingMetrics]
        }).reduce((acc, val) => [...acc, ...val], [])

        if(metricData.length > 9) {
            const chunks = ArrayChunk(metricData,10);
            
            const cloudwatchResponses = chunks.map(metric => {
                
                const params = {
                    Namespace: event.namespace || "Watchtower",
                    MetricData: metric,
                }
                return cloudwatch.putMetricData(params).promise()
            })
            
            return Promise.all(cloudwatchResponses)
                .then(responses => {
                    callback(null,responses)
            })
            .catch(errors => {
                callback(errors,null)
            })
            
        } else {
            const params = {
                Namespace: event.namespace || "Watchtower",
                MetricData: metricData,
            }
            return cloudwatch.putMetricData(params).promise()
            .then(data => {
                callback(null,data);
            })
            .catch(error => {
                callback(error,null);
            });
        }

    })
    .catch(error => {
        callback(error)
    })
}
