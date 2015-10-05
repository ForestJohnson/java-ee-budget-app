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
                    "type": "string",
                    "name": "categoryName",
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
            "name": "TransactionList",
            "fields": [
                {
                    "rule": "optional",
                    "type": "PageInfo",
                    "name": "pageInfo",
                    "id": 1
                },
                {
                    "rule": "repeated",
                    "type": "Filter",
                    "name": "filters",
                    "id": 2
                },
                {
                    "rule": "repeated",
                    "type": "Transaction",
                    "name": "transactions",
                    "id": 3
                }
            ]
        },
        {
            "name": "UnsortedTransaction",
            "fields": [
                {
                    "rule": "optional",
                    "type": "Transaction",
                    "name": "transaction",
                    "id": 1
                },
                {
                    "rule": "repeated",
                    "type": "TransactionCategory",
                    "name": "categories",
                    "id": 3
                }
            ]
        },
        {
            "name": "PageInfo",
            "fields": [
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "currentPage",
                    "id": 1,
                    "options": {
                        "default": 1
                    }
                },
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "pageCount",
                    "id": 2
                },
                {
                    "rule": "optional",
                    "type": "uint32",
                    "name": "resultsPerPage",
                    "id": 3,
                    "options": {
                        "default": 10
                    }
                }
            ]
        },
        {
            "name": "Filter",
            "fields": [
                {
                    "rule": "optional",
                    "type": "DateRangeFilter",
                    "name": "dateRangeFilter",
                    "id": 1
                }
            ],
            "oneofs": {
                "filter_type": [
                    1
                ]
            }
        },
        {
            "name": "DateRangeFilter",
            "fields": [
                {
                    "rule": "optional",
                    "type": "int64",
                    "name": "start",
                    "id": 1
                },
                {
                    "rule": "optional",
                    "type": "int64",
                    "name": "end",
                    "id": 2
                }
            ]
        }
    ]
}).build();