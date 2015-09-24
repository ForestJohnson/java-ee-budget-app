module.exports = require("protobufjs").newBuilder({})['import']({
    "package": "com.ilmservice.personalbudget",
    "options": {
        "java_package": "com.ilmservice.personalbudget.protobufs"
    },
    "messages": [
        {
            "name": "UploadSpreadsheetEvent",
            "fields": [
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "userId",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "int64",
                    "name": "timestamp",
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