package com.ilmservice.personalbudget.data;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.personalbudget.protobufs.Views.UnsortedTransaction;

public interface ITransactionStore {

	Transaction post(Builder builder);
	
	void put(Transaction transaction);
	
	TransactionList postAll(TransactionList transactions);
	
	TransactionList list(TransactionList query);
	
	Transaction getUnsortedTransaction();

}
