module.exports = require("protobufjs").newBuilder({})['import']({
    "package": "com.ilmservice.personalbudget",
    "options": {
        "java_package": "com.ilmservice.personalbudget.protobufs"
    },
    "messages": [
        {
            "name": "Transaction",
            "fields": [
                {
                    "rule": "optional",
                    "type": "bytes",
                    "name": "id",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "categoryId",
                    "id": 2
                },
                {
                    "rule": "repeated",
                    "type": "uint32",
                    "name": "tagIds",
                    "id": 3
                },
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "userId",
                    "id": 4
                },
                {
                    "rule": "optional",
                    "type": "uint64",
                    "name": "date",
                    "id": 5
                },
                {
                    "rule": "optional",
                    "type": "sint32",
                    "name": "cents",
                    "id": 6
                },
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "description",
                    "id": 7
                },
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "card",
                    "id": 8
                },
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "checkNumber",
                    "id": 9
                }
            ]
        }
    ]
}).build();