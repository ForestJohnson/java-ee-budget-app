package com.ilmservice.personalbudget.data;

import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

public interface IEventStore {

	public void uploadSpreadsheet(UploadSpreadsheetEvent event);
}
