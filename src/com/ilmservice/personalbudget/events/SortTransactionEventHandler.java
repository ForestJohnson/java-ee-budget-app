package com.ilmservice.personalbudget.events;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

import com.ilmservice.personalbudget.data.ICategorySuggestionStore;
import com.ilmservice.personalbudget.data.IEventStore;
import com.ilmservice.personalbudget.data.ITransactionCategoryStore;
import com.ilmservice.personalbudget.data.ITransactionStore;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.personalbudget.protobufs.Events.SortTransactionEvent;


@Default
@Stateless
public class SortTransactionEventHandler implements ISortTransactionEventHandler {
	
	@Inject private ITransactionStore transactionStore;
	@Inject private ITransactionCategoryStore transactionCategoryStore;
	@Inject private ICategorySuggestionStore categorySuggestionStore;
	@Inject private IEventStore eventStore;
	
	@Override
	public void sortTransaction(Event event) throws Exception {
		System.out.println("1");
		eventStore.put(event);
		System.out.println("2");
		SortTransactionEvent toSort = event.getSortTransactionEvent();
    	int desiredId = toSort.getCategory().getId();
    	System.out.println("3");
    	if(desiredId == 0 || transactionCategoryStore.get(desiredId).getId() != desiredId) {
    		desiredId = transactionCategoryStore.put(
    				TransactionCategory.newBuilder( toSort.getCategory() )
    			).getId();
    	}
    	Transaction result = Transaction.newBuilder(toSort.getTransaction()).setCategoryId(desiredId).build();
    	System.out.println(result.toString());
    	transactionStore.put(result);
    	System.out.println("5");
    	
    	System.out.println(transactionStore.getUnsortedTransaction().toString());
    	
    	
    	categorySuggestionStore.put(result);
    	System.out.println("6");
	};
}
