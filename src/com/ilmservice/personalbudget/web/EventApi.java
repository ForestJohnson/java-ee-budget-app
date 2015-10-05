package com.ilmservice.personalbudget.web;

import javax.ejb.Stateless;
import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;
import javax.ws.rs.Consumes;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.Response;

import com.ilmservice.personalbudget.data.IEventStore;
import com.ilmservice.personalbudget.data.ITransactionStore;
import com.ilmservice.personalbudget.events.ISpreadsheetUploadEventHandler;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.repository.TransactionPerRequest;


@Stateless
// empty path annotation is required for the methods to be able to specify thier own paths. 
@Path("")
public class EventApi {
	
	@Inject private ISpreadsheetUploadEventHandler spreadsheetUploadHandler;
	@Inject private ITransactionStore transactionStore;
	
    @POST
    @Path("spreadsheet")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public TransactionList spreadsheet(Event event) throws Exception {
    	return spreadsheetUploadHandler.uploadSpreadsheet(event);
    }
    
    @POST
    @Path("putTransactions")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public TransactionList putTransactions(TransactionList transactions) throws Exception {
    	return transactionStore.putAll(transactions);
    }
    
    @POST
    @Path("transactions")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public TransactionList transactions(TransactionList query) throws Exception {
    	return transactionStore.list(query);
    }
    
	
//	@Inject private ITransactionStore transactionStore;
//	
//    @POST
//    @Path("test")
//    @Produces("application/x-protobuf")
//    @Consumes("application/x-protobuf")
//    public Response test(Transaction transaction) {
//    	 
//    	 transactionStore.test(transaction.getId());
//
//         return Response.ok().build();
//    }
	
}
