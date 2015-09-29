package com.ilmservice.personalbudget.events;

import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

public interface ISpreadsheetUploadEventHandler {

	void uploadSpreadsheet(Event event) throws Exception;
}
