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
        },
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
                    "id": 10,
                    "oneof": "event_type"
                },
                {
                    "rule": "optional",
                    "type": "SortTransactionEvent",
                    "name": "sortTransactionEvent",
                    "id": 11,
                    "oneof": "event_type"
                }
            ],
            "oneofs": {
                "event_type": [
                    10,
                    11
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
                            "name": "UNKNOWN",
                            "id": 0
                        },
                        {
                            "name": "BREMER",
                            "id": 1
                        },
                        {
                            "name": "GNUCASH_CUSTOM",
                            "id": 2
                        },
                        {
                            "name": "GNUCASH_ASSET_EXPORT",
                            "id": 3
                        }
                    ]
                }
            ]
        },
        {
            "name": "SpreadsheetRow",
            "fields": [
                {
                    "rule": "optional",
                    "type": "int32",
                    "name": "index",
                    "id": 2
                },
                {
                    "rule": "repeated",
                    "type": "string",
                    "name": "fields",
                    "id": 1
                }
            ]
        },
        {
            "name": "SortTransactionEvent",
            "fields": [
                {
                    "rule": "optional",
                    "type": "Transaction",
                    "name": "transaction",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "TransactionCategory",
                    "name": "category",
                    "id": 3
                }
            ]
        }
    ]
}).build();