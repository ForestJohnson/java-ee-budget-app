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
                    "rule": "optional",
                    "type": "TransactionCategory",
                    "name": "category",
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
        },
        {
            "name": "TransactionCategory",
            "fields": [
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "id",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "Color",
                    "name": "color",
                    "id": 2
                },
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "name",
                    "id": 3
                }
            ]
        },
        {
            "name": "Color",
            "fields": [
                {
                    "rule": "optional",
                    "type": "float",
                    "name": "h",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "float",
                    "name": "s",
                    "id": 2
                },
                {
                    "rule": "optional",
                    "type": "float",
                    "name": "v",
                    "id": 3
                }
            ]
        },
        {
            "name": "CategoryKeyword",
            "fields": [
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "keyword",
                    "id": 1
                },
                {
                    "rule": "repeated",
                    "type": "CategorySuggestion",
                    "name": "suggestions",
                    "id": 2
                }
            ]
        },
        {
            "name": "CategorySuggestion",
            "fields": [
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "categoryId",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "popularity",
                    "id": 2
                }
            ]
        }
    ]
}).build();