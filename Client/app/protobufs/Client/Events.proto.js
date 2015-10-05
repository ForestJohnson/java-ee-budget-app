module.exports = require("protobufjs").newBuilder({})['import']({
    "package": "com.ilmservice.personalbudget",
    "options": {
        "java_package": "com.ilmservice.personalbudget.protobufs"
    },
    "messages": [
        {
            "name": "Event",
            "fields": [
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "userId",
                    "id": 2
                },
                {
                    "rule": "optional",
                    "type": "int64",
                    "name": "date",
                    "id": 3
                },
                {
                    "rule": "optional",
                    "type": "UploadSpreadsheetEvent",
                    "name": "uploadSpreadsheetEvent",
                    "id": 10
                }
            ],
            "oneofs": {
                "event_type": [
                    10
                ]
            }
        },
        {
            "name": "UploadSpreadsheetEvent",
            "fields": [
                {
                    "rule": "optional",
                    "type": "SpreadsheetSource",
                    "name": "source",
                    "id": 2
                },
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "filename",
                    "id": 3
                },
                {
                    "rule": "repeated",
                    "type": "SpreadsheetRow",
                    "name": "rows",
                    "id": 4
                }
            ],
            "enums": [
                {
                    "name": "SpreadsheetSource",
                    "values": [
                        {
                            "name": "BREMER",
                            "id": 0
                        }
                    ]
                }
            ]
        },
        {
            "name": "SpreadsheetRow",
            "fields": [
                {
                    "rule": "repeated",
                    "type": "string",
                    "name": "fields",
                    "id": 1
                }
            ]
        }
    ]
}).build();