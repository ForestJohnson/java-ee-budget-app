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
import com.ilmservice.personalbudget.protobufs.Views.DateRangeFilter;
import com.ilmservice.personalbudget.protobufs.Views.Filter;
import com.ilmservice.personalbudget.protobufs.Views.ReportDataGroup;
import com.ilmservice.personalbudget.protobufs.Views.ReportDataPoint;
import com.ilmservice.personalbudget.protobufs.Views.ReportDataSeries;
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
    	Map<Integer, TransactionCategory> categories = getTransactionCategories();
    	
    	TransactionList.Builder builder = TransactionList.newBuilder(query).clearTransactions();
    	
    	transactionStore.withStream(query.getFiltersList(), true, (s) -> {
			return builder.addAllTransactions(
					() ->
					s.map(
						(t) -> {
							return Transaction.newBuilder(t)
							.setCategory(categories.compute(
									t.getCategoryId(), 
									(k, v) -> (v != null ? v : TransactionCategory.getDefaultInstance())
							)).build();
						}).iterator()
					);
    	});
    	
    	return builder.build();
    }
    
    @GET
    @Path("getUnsortedTransaction")
    @Produces("application/x-protobuf")
    public UnsortedTransaction getUnsortedTransaction() throws Exception {
    	Transaction transaction = transactionStore.getUnsortedTransaction();
    	if(transaction != null) {
    		Map<Integer, Float> suggestions = categorySuggestionStore.suggest(transaction);

    		UnsortedTransaction.Builder builder = UnsortedTransaction.newBuilder()
    				.setTransaction(transaction);
    		
    		transactionCategoryStore.withStream((s) -> 
	    		builder.addAllCategories(
	    			() ->
					s.sorted((a,b) -> {
				    	float result = 
				    			suggestions.compute(b.getId(), (id, value) -> value == null ? 0 : value) 
				    		  - suggestions.compute(a.getId(), (id, value) -> value == null ? 0 : value);
				    	return result > 0 ? 1 : (result < 0 ? -1 : 0);
					}).iterator()
				)
			);
    		
    		return builder.build();
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
	
    @POST
    @Path("dataSeries")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public ReportDataSeries dataSeries(ReportDataSeries input) throws Exception {
    	DateRangeFilter filter = input.getFiltersList()
    	.stream()
    	.filter((f) -> f.getDateRangeFilter() != null)
    	.map((f) -> f.getDateRangeFilter())
    	.findFirst()
    	.orElse(DateRangeFilter.newBuilder().build());
    	
    	long end = filter.getEnd();
    	long start = filter.getStart();
    	
    	if(start == 0) {
    		start = transactionStore.withStream(new ArrayList<Filter>(), false, (s) -> 
    			s.map((t) -> t.getDate())
    			.findFirst().orElse(0L)
        	);
    	}
    	if(end == 0) {
    		end = transactionStore.withStream(new ArrayList<Filter>(), true, (s) -> 
    			s.map((t) -> t.getDate())
    			.findFirst().orElse(0L)
        	);
    	}
    	if(end < start || (end-start) / input.getFrequency() > 100) {
    		throw new Exception("Sanity check failed, make sure your filter and frequency is set up correctly!");
    	}
    	
    	Map<Integer, TransactionCategory> categories = getTransactionCategories();
    	ReportDataSeries.Builder builder = ReportDataSeries.newBuilder();
    	
    	for(long t = start; t < end; t += input.getFrequency()) {
    		List<Filter> filters = new ArrayList<Filter>();
    		filters.add(
    				Filter.newBuilder()
    				.setDateRangeFilter(
    					DateRangeFilter.newBuilder()
    					.setStart(t)
    					.setEnd(t+input.getFrequency())
    				).build()
    			);
    		builder.addSeries(getDataGroup(categories, filters));
    	}
    	
    	return builder.build();
    }
    
    @POST
    @Path("dataGroup")
    @Produces("application/x-protobuf")
    @Consumes("application/x-protobuf")
    public ReportDataGroup dataGroup(ReportDataGroup input) throws Exception {
    	Map<Integer, TransactionCategory> categories = getTransactionCategories();

    	return getDataGroup(categories, input.getFiltersList());
    }
    
    private ReportDataGroup getDataGroup(Map<Integer, TransactionCategory> categories, List<Filter> filters) {
    	Map<Integer, Integer> data = transactionStore.aggregate(filters);
    	
    	return ReportDataGroup.newBuilder()
    			.addAllFilters(filters)
    			.addAllData(
    			() ->
    			categories.values().stream()
    			.map(
    				(category) -> ReportDataPoint.newBuilder()
    					.setCategory(category)
    					.setCents(data.compute(category.getId(), (k,v) -> v == null ? 0 : v))
    					.build()
    			).iterator()
    		).build();
    }
    
    private Map<Integer, TransactionCategory> getTransactionCategories() {
    	return transactionCategoryStore.withStream((s) ->
			s.collect(
				HashMap<Integer, TransactionCategory>::new, 
				(map, c) -> map.put(c.getId(), c), 
				Map<Integer, TransactionCategory>::putAll
			)
		);
    }
}
