package com.ilmservice.personalbudget.data;

import java.io.IOException;

import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

public interface IEventStore {

	void put(Event event) throws IOException;

}
