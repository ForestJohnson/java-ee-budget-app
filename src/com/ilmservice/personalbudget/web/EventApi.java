package com.ilmservice.personalbudget.web;

import javax.ejb.Stateless;
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
import com.ilmservice.personalbudget.protobufs.Events.UploadSpreadsheetEvent;


@Stateless
// empty path annotation is required for the methods to be able to specify thier own paths. 
@Path("")
public class EventApi {
	
//	@Inject private ISpreadsheetUploadEventHandler eventStore;
//	
//    @POST
//    @Path("spreadsheet")
//    @Produces("application/x-protobuf")
//    @Consumes("application/x-protobuf")
//    public Response spreadsheet(UploadSpreadsheetEvent event) {
//    	 
//    	 eventStore.uploadSpreadsheet(event);
//
//         return Response.ok().build();
//    }
    
	@Inject private ITransactionStore transactionStore;
	
    @POST
    @Path("test")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public Response test(Transaction transaction) {
    	 
    	 transactionStore.test(transaction.getId());

         return Response.ok().build();
    }
	
}
