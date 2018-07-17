# lambda-watchtower
`lambda-watchtower` is a script for monitoring one or several HTTP(S) endpoints with AWS Lambda.
Logs are stored as AWS CloudWatch metrics.

# Usage
`lambda-watchtower` supports the following event parameters:
```(javascript)
{
  "targets": [
    {
      "url": "https://example.org",
      "name": "example.org", //Optional, defaults to url; Display name of the target
    },
	{
	  "name": "Mailserver SMTP port check",
	  "type": "port",
	  "url": "mailserver.example.org",
	  "port": 25
	}
  ],
  "namespace": "Watchtower", //Optional, defaults to "Watchtower"; CloudWatch namespace
  "timings": ["readable", "total"], Optional, defaults to ["readable", "total"]; Determine which timings are logged.
  "timeout": 2000 //Optional, defaults to 2000: Time in ms before requests are aborted
}
```

## Supported Timings
The following timings are supported and can be logged by `lambda-watchtower`:

- `lookup`: Time between beginning of request and successful DNS lookup
- `connect`: Time between DNS lookup and TCP connect
- `secureConnect`: Time between TCP connect and completion of HTTPS handshake
- `readable`: Time between successfully establishing the connection (and HTTPS handshake) and first byte received
- `close`: Time between first byte and the end of the request
- `total`: Total time from the beginning to the end of the request


# Setup Guide

 - Create a new IAM Lambda Role that has access to PUT CloudWatch Metrics
 - Create a new Lambda Function with the contents of `index.js` assign the IAM role created above to this function
 - Create a new CloudWatch Event Rule of type schedule
 - Select how often you would like to check your endpoints
 - Add the new Lambda function as the target
 - Configure the input of the target and select "Constant (JSON text)"
 - Put the configuration JSON (from above) into the Constant JSON text field
 - Save everything and give it a few minutes, new CloudWatch metrics take additional time to show up

# Contributing
Pull requests and issues for additional features are welcome.

# License
`lambda-watchtower` is licensed under the terms of the MIT license. For further information, please refer to the `LICENSE` file.
