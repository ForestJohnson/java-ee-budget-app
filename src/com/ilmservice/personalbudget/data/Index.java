package com.ilmservice.personalbudget.data;

public enum Index {
	EventsById(1);
	
	Index(int value) {
		this.value = value;
	}
	private int value = 0;
	
	public int getValue() {
		return value;
	}
}
