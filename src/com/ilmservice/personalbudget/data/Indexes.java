package com.ilmservice.personalbudget.data;

public enum Indexes {
	EventsById(1),
	TransactionsByCategory(10),
	TransactionsByDate(11),
	TransactionCategoriesById(20),
	TransactionCategoriesByKeyword(30);
    
	private Indexes(int value) {
        this.value = (short)value;
    }
    private short value = 0;
    
    public short getValue() {
        return value;
    }

}
