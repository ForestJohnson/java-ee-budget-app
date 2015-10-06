package com.ilmservice.personalbudget.data;

import java.io.IOException;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.personalbudget.protobufs.Views.UnsortedTransaction;

public interface ITransactionStore {

	Transaction post(Builder builder) throws IOException;
	
	void put(Transaction transaction) throws IOException;
	
	TransactionList postAll(TransactionList transactions);
	
	TransactionList list(TransactionList query);
	
	Transaction getUnsortedTransaction();

}
