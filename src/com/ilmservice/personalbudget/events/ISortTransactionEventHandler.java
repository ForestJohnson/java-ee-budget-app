package com.ilmservice.personalbudget.events;

import com.ilmservice.personalbudget.protobufs.Events.Event;

public interface ISortTransactionEventHandler {
	void sortTransaction(Event event) throws Exception;
}
