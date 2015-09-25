package com.ilmservice.personalbudget.web;

import javax.ejb.Stateless;
import javax.inject.Inject;
import javax.ws.rs.Consumes;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.service.IRestartService;

@Stateless
@Path("event")
public class EventApi {
	
	@Inject private IRestartService restartService;
	
    @POST
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public Transaction post(Transaction requestBody) {
    	 
    	 Transaction transaction = restartService.getData(requestBody.getTransactionId());

         return transaction;
    }
	
}
