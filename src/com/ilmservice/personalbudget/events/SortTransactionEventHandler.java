package com.ilmservice.personalbudget.events;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;

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
	
	@Override
	public void sortTransaction(Event event) throws Exception {
		SortTransactionEvent toSort = event.getSortTransactionEvent();
    	int desiredId = toSort.getCategory().getId();
    	if(transactionCategoryStore.get(desiredId).getId() != desiredId) {
    		desiredId = transactionCategoryStore.put(
    				TransactionCategory.newBuilder( toSort.getCategory() )
    			).getId();
    	}
    	transactionStore.put(
    			Transaction.newBuilder(toSort.getTransaction()).setCategoryId(desiredId).build()
    		);
	};
}
