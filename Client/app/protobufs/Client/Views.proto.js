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
                    "type": "uint32",
                    "name": "transactionId",
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
                    "name": "timestamp",
                    "id": 5
                },
                {
                    "rule": "optional",
                    "type": "sint32",
                    "name": "dollars",
                    "id": 6
                },
                {
                    "rule": "optional",
                    "type": "string",
                    "name": "description",
                    "id": 7
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