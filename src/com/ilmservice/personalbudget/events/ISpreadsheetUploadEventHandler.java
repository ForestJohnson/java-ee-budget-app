package com.ilmservice.personalbudget.events;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;

public interface ISpreadsheetUploadEventHandler {

	TransactionList uploadSpreadsheet(Event event) throws Exception;
}
