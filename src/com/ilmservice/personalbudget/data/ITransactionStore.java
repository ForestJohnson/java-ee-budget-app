package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Stream;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.Transaction.Builder;
import com.ilmservice.personalbudget.protobufs.Views.Filter;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;

public interface ITransactionStore {

	Transaction post(Builder builder) throws IOException;
	
	void put(Transaction transaction) throws IOException;
	
	TransactionList postAll(TransactionList transactions);
	
	Transaction getUnsortedTransaction();
 
	Map<Integer, Integer> aggregate(List<Filter> filters);

	<R> R withStream(List<Filter> filters, boolean descending, Function<Stream<Transaction>, R> action);
}
