package com.ilmservice.personalbudget.data;

public enum Indexes {
	EventsById(1),
	TransactionsById(10),
	TransactionsByDate(11);
    
	private Indexes(int value) {
        this.value = (short)value;
    }
    private short value = 0;
    
    public short getValue() {
        return value;
    }

}
