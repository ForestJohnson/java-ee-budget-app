package com.ilmservice.personalbudget.web;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.ejb.Stateless;
import javax.inject.Inject;
import javax.ws.rs.Consumes;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.Response;

import com.ilmservice.personalbudget.data.ICategorySuggestionStore;
import com.ilmservice.personalbudget.data.ITransactionCategoryStore;
import com.ilmservice.personalbudget.data.ITransactionStore;
import com.ilmservice.personalbudget.events.ISortTransactionEventHandler;
import com.ilmservice.personalbudget.events.ISpreadsheetUploadEventHandler;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.personalbudget.protobufs.Views.UnsortedTransaction;


@Stateless
// empty path annotation is required for the methods to be able to specify thier own paths. 
@Path("")
public class EventApi {
	
	@Inject private ISpreadsheetUploadEventHandler spreadsheetUploadHandler;
	@Inject private ITransactionStore transactionStore;
	@Inject private ITransactionCategoryStore transactionCategoryStore;
	@Inject private ICategorySuggestionStore categorySuggestionStore;
	@Inject private ISortTransactionEventHandler sortTransactionHandler;
	
    @POST
    @Path("spreadsheet")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public TransactionList spreadsheet(Event event) throws Exception {
    	return spreadsheetUploadHandler.uploadSpreadsheet(event);
    }
    
    @POST
    @Path("postTransactions")
    @Consumes("application/x-protobuf")
    public Response putTransactions(TransactionList transactions) throws Exception {
    	transactionStore.postAll(transactions);
    	return Response.ok().build();
    }
    
    @POST
    @Path("listTransactions")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public TransactionList transactions(TransactionList query) throws Exception {
    	Map<Integer, TransactionCategory> categories = transactionCategoryStore.withStream((s) ->
    		s.collect(
    			HashMap<Integer, TransactionCategory>::new, 
    			(map, c) -> map.put(c.getId(), c), 
    			Map<Integer, TransactionCategory>::putAll
    		)
    	);
    	
    	return TransactionList.newBuilder(query)
	    	.clearTransactions()
	    	.addAllTransactions(
	    		transactionStore.withStream(query, (s) -> {
	    			return s.map(
	    				(t) -> Transaction.newBuilder(t)
	    				.setCategory(categories.compute(
	    						t.getCategoryId(), 
	    						(k, v) -> v != null ? v : TransactionCategory.getDefaultInstance()
	    					))
	    				.build()
		    		).collect(
		    			ArrayList<Transaction>::new,
		    			List<Transaction>::add,
		    			List::addAll
		    		);
	    		})
	    	)
	    .build();
    }
    
    @GET
    @Path("getUnsortedTransaction")
    @Produces("application/x-protobuf")
    public UnsortedTransaction getUnsortedTransaction() throws Exception {
    	Transaction transaction = transactionStore.getUnsortedTransaction();
    	if(transaction != null) {
    		Map<Integer, Float> suggestions = categorySuggestionStore.suggest(transaction);

    		return UnsortedTransaction.newBuilder()
    				.setTransaction(transaction)
    				.addAllCategories(
	    				transactionCategoryStore.withStream((s) -> 
		    				s.sorted((a,b) -> {
		    			    	float result = 
		    			    			suggestions.compute(b.getId(), (id, value) -> value == null ? 0 : value) 
		    			    		  - suggestions.compute(a.getId(), (id, value) -> value == null ? 0 : value);
		    			    	return result > 0 ? 1 : (result < 0 ? -1 : 0);
							}).collect(
			    			    	ArrayList<TransactionCategory>::new, 
			    			    	List<TransactionCategory>::add, 
			    			    	List<TransactionCategory>::addAll
			    			)
	    				)
	    			).build();
    	} else {
    		return UnsortedTransaction.getDefaultInstance();
    	}
    }
    
    @POST
    @Path("sortTransaction")
    @Consumes("application/x-protobuf")
    public Response sortTransaction(Event event) throws Exception {
    	
    	try {
    		sortTransactionHandler.sortTransaction(event);
    	} catch (Exception ex) {
    		System.out.println("sortTransaction:");
    		System.out.println(ex.toString());
    	}
    	
    	return Response.ok().build();
    }
	
//    @POST
//    @Path("dataSeries")
//    @Produces("application/x-protobuf")
//    @Consumes("application/x-protobuf")
//    public ReportDataSeries dataSeries(ReportDataSeries input) throws Exception {
//    	
//    }
//    
//    @POST
//    @Path("dataGroup")
//    @Produces("application/x-protobuf")
//    @Consumes("application/x-protobuf")
//    public ReportDataGroup dataGroup(ReportDataGroup input) throws Exception {
//    	
//    }
}
