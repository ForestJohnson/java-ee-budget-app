package com.ilmservice.personalbudget.events;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.ilmservice.personalbudget.data.IEventStore;
import com.ilmservice.personalbudget.data.ITransactionStore;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;

@Default
@Stateless
public class SpreadsheetUploadEventHandler implements ISpreadsheetUploadEventHandler {
	
	@Inject private IEventStore eventStore;
	@Inject private ITransactionStore transactionStore;
	
	@Override
	public void uploadSpreadsheet(UploadSpreadsheetEvent event) {
		
	}
}
