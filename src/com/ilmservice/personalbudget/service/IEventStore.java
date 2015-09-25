package com.ilmservice.personalbudget.service;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

public interface IEventStore extends AutoCloseable {

	public void uploadSpreadsheet(UploadSpreadsheetEvent event);
}
