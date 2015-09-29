package com.ilmservice.personalbudget.events;

import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

public interface ISpreadsheetUploadEventHandler {
	public void uploadSpreadsheet(UploadSpreadsheetEvent event);
}
