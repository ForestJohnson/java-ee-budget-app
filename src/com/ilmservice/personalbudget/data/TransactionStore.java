package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;

@Default
@Singleton
public class TransactionStore implements ITransactionStore {
	
	@Inject public IRepository<Transaction> transactions;
	public IRepositoryIndex<Integer, Transaction> transactionsById;
	
	@PostConstruct
	public void configure() {
		System.out.println("TransactionStore configuring");
		transactions.configure( 
			(bytes) -> Transaction.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("TransactionStore indexes");
					transactionsById = transactions.configureIndex(
						Indexes.TransactionsById.getValue(),
						(k) -> Transaction.newBuilder().setId(k).build(),
						(v) -> v.getId(),
						(k) -> ByteBuffer.allocate(4).putInt(k).array()	
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
	}
	
	public Transaction test(int id) {
		Transaction modified = null;
		try {
			System.out.println("TransactionStore testing  ");
			Transaction result = transactionsById.query().atKey(id).firstOrDefault();
			System.out.println(result.toString());
			modified = Transaction.newBuilder(result)
									.setDescription(result.getDescription() + " :)  ").build();
			
			System.out.println(modified.toString());
			transactions.put(modified);
			
		} catch (IOException e) {
			System.out.println("TransactionStore testing failed ");
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		return modified;
	}
}
