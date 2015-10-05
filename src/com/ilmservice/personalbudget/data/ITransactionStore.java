package com.ilmservice.personalbudget.data;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;

public interface ITransactionStore {

	Transaction put(Builder builder);
	
	TransactionList putAll(TransactionList transactions);
	
	TransactionList list(TransactionList query);

}
