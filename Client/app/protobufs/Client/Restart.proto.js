module.exports = require("protobufjs").newBuilder({})['import']({
    "package": null,
    "options": {
        "java_package": "com.ilmservice.personalbudget.protobufs"
    },
    "messages": [
        {
            "name": "Test",
            "fields": [
                {
                    "rule": "optional",
                    "type": "int32",
                    "name": "id",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "greeting",
                    "id": 2
                }
            ]
        }
    ]
}).build();